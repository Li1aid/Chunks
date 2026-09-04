import Foundation
import SwiftData

enum SyncStatus: Equatable {
    case idle
    case syncing
    case success(at: Date)
    case failed(error: String)

    var displayText: String {
        switch self {
        case .idle: "未配置"
        case .syncing: "同步中…"
        case .success(let date): "上次同步：\(Self.relativeTime(from: date))"
        case .failed(let error): error
        }
    }

    private static func relativeTime(from date: Date) -> String {
        let seconds = -date.timeIntervalSinceNow
        if seconds < 60 { return "刚刚" }
        if seconds < 3600 { return "\(Int(seconds / 60)) 分钟前" }
        if seconds < 86400 { return "\(Int(seconds / 3600)) 小时前" }
        return "\(Int(seconds / 86400)) 天前"
    }
}

@Observable
final class CloudSyncService {
    var syncStatus: SyncStatus = .idle
    private(set) var isConfigured = false

    private let container: ModelContainer
    private var pendingTask: Task<Void, Never>?

    // Pull 游标：服务端时间，用于 GET /sync/cards?since=
    private var lastPullServerTime: Double {
        get { UserDefaults.standard.double(forKey: "lastPullServerTime") }
        set { UserDefaults.standard.set(newValue, forKey: "lastPullServerTime") }
    }

    // Push 游标：本地时间，用于筛选哪些卡要推。与 Pull 完全独立，避免时钟偏差
    private var lastPushAt: Double {
        get { UserDefaults.standard.double(forKey: "lastPushAt") }
        set { UserDefaults.standard.set(newValue, forKey: "lastPushAt") }
    }

    init(container: ModelContainer) {
        self.container = container
        refreshConfig()
        let lastSyncEpoch = UserDefaults.standard.double(forKey: "lastSyncAt")
        if lastSyncEpoch > 0 && isConfigured {
            syncStatus = .success(at: Date(timeIntervalSince1970: lastSyncEpoch))
        }
    }

    func refreshConfig() {
        let url = UserDefaults.standard.string(forKey: "workerURL") ?? ""
        let token = KeychainHelper.read(key: "appToken") ?? ""
        isConfigured = !url.isEmpty && !token.isEmpty
    }

    @MainActor
    func resetSync() async {
        let context = container.mainContext
        do {
            let allCards = try context.fetch(FetchDescriptor<Card>())
            for card in allCards {
                context.delete(card)
            }
            try context.save()
        } catch {
            print("[ResetSync] Failed to clear local cards: \(error)")
        }
        lastPullServerTime = 0
        lastPushAt = 0
        UserDefaults.standard.removeObject(forKey: "lastSyncAt")
        await syncNow()
    }

    @MainActor
    func softDeleteCard(id: String) {
        let context = container.mainContext
        let descriptor = FetchDescriptor<Card>(
            predicate: #Predicate { $0.id == id }
        )
        do {
            guard let card = try context.fetch(descriptor).first else { return }
            // 直接操作 Int 存储字段,绕过 SwiftData 1.x 的 Bool save() 重置 bug
            card.isDeletedRaw = 1
            card.updatedAt = Date().timeIntervalSince1970 * 1000
            try context.save()
            print("[softDeleteCard] OK: \(card.en) isDeletedRaw=\(card.isDeletedRaw)")
            scheduleSync()
        } catch {
            print("[softDeleteCard] error: \(error)")
        }
    }

    func scheduleSync(after delay: TimeInterval = 1.5) {
        guard isConfigured else { return }
        pendingTask?.cancel()
        pendingTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            await self?.syncNow()
        }
    }

    @MainActor
    func syncNow() async {
        guard isConfigured else {
            syncStatus = .idle
            return
        }
        if case .syncing = syncStatus { return }
        syncStatus = .syncing

        let workerURL = (UserDefaults.standard.string(forKey: "workerURL") ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let appToken = KeychainHelper.read(key: "appToken") ?? ""

        do {
            let pullSince = lastPullServerTime
            let pushSince = lastPushAt
            let pushStartedAt = Date().timeIntervalSince1970 * 1000

            // === Sync Start ===
            let context = container.mainContext
            let allLocal = try context.fetch(FetchDescriptor<Card>())
            let localVisible = allLocal.filter { $0.isDeletedRaw == 0 }
            let localDeleted = allLocal.filter { $0.isDeletedRaw != 0 }
            print("=== Sync Start ===")
            print("Local total cards: \(allLocal.count)")
            print("Local visible cards: \(localVisible.count)")
            print("Local with isDeleted=true: \(localDeleted.count)")
            for c in localDeleted {
                print("  deleted: id=\(c.id) en=\(c.en) updatedAt=\(c.updatedAt)")
            }
            print("lastPullServerTime: \(pullSince)")
            print("lastPushAt: \(pushSince)")

            // --- Pull ---
            let (remoteCards, serverTime) = try await pull(
                workerURL: workerURL, appToken: appToken, since: pullSince
            )
            print("--- Pull ---")
            print("Server returned \(remoteCards.count) cards")
            for r in remoteCards.prefix(10) {
                let en = r["en"] as? String ?? "?"
                let del = r["deleted"] as? Bool ?? false
                let upd = r["updatedAt"] as? Double ?? 0
                print("  - \(en) | deleted=\(del) | updatedAt=\(upd)")
            }
            print("Server time: \(serverTime)")

            // --- Merge ---
            print("--- Merge ---")
            var localMap: [String: Card] = [:]
            for card in allLocal { localMap[card.id] = card }

            var mergedCount = 0
            for remote in remoteCards {
                guard let remoteId = remote["id"] as? String else { continue }
                let remoteUpdatedAt = (remote["updatedAt"] as? Double) ?? 0
                let remoteEn = remote["en"] as? String ?? "?"

                if let existing = localMap[remoteId] {
                    if remoteUpdatedAt > existing.updatedAt {
                        print("  MERGE \(remoteEn): local.updatedAt=\(existing.updatedAt) vs remote.updatedAt=\(remoteUpdatedAt) -> REMOTE WINS")
                        Self.applyRemote(remote, to: existing)
                        mergedCount += 1
                    } else {
                        print("  MERGE \(remoteEn): local.updatedAt=\(existing.updatedAt) vs remote.updatedAt=\(remoteUpdatedAt) -> LOCAL WINS")
                    }
                } else {
                    print("  INSERT \(remoteEn) (new from server)")
                    let card = Self.cardFromRemote(remote)
                    context.insert(card)
                    mergedCount += 1
                }
            }
            if mergedCount > 0 {
                try context.save()
            }
            print("Merged: \(mergedCount) cards updated/inserted")

            // Pull 完成，立即更新 pull 游标
            lastPullServerTime = serverTime

            // --- Push ---
            let allForPush = try context.fetch(FetchDescriptor<Card>())
            let toPush = allForPush.filter { $0.updatedAt > pushSince }
            print("--- Push ---")
            print("To push: \(toPush.count) cards (pushSince=\(pushSince))")
            for c in toPush.prefix(10) {
                print("  - \(c.en) | isDeletedRaw=\(c.isDeletedRaw) | updatedAt=\(c.updatedAt)")
            }
            if !toPush.isEmpty {
                let dicts = toPush.map { Self.cardToDict($0) }
                try await push(workerURL: workerURL, appToken: appToken, cards: dicts)
                print("Push succeeded: \(toPush.count) cards")
            }

            // Push 成功，更新 push 游标
            lastPushAt = pushStartedAt
            let now = Date()
            UserDefaults.standard.set(now.timeIntervalSince1970, forKey: "lastSyncAt")
            syncStatus = .success(at: now)
            print("=== Sync End ===")

        } catch let error as SyncError {
            syncStatus = .failed(error: error.localizedDescription)
        } catch is CancellationError {
            // Cancelled — don't touch status
        } catch {
            syncStatus = .failed(error: "网络连接失败")
        }
    }

    // MARK: - Network

    private func pull(workerURL: String, appToken: String, since: Double) async throws -> ([[String: Any]], Double) {
        let url = URL(string: "\(workerURL)/sync/cards?since=\(Int(since))")!
        var request = URLRequest(url: url)
        request.setValue(appToken, forHTTPHeaderField: "x-app-token")

        let (data, response) = try await URLSession.shared.data(for: request)
        try Self.checkHTTP(response)

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let cards = json["cards"] as? [[String: Any]] ?? []
        let serverTime = json["serverTime"] as? Double ?? Date().timeIntervalSince1970 * 1000
        return (cards, serverTime)
    }

    private func push(workerURL: String, appToken: String, cards: [[String: Any]]) async throws {
        let batchSize = 500
        for i in stride(from: 0, to: cards.count, by: batchSize) {
            let batch = Array(cards[i..<min(i + batchSize, cards.count)])
            let url = URL(string: "\(workerURL)/sync/cards")!
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(appToken, forHTTPHeaderField: "x-app-token")
            request.httpBody = try JSONSerialization.data(withJSONObject: ["cards": batch])

            let (_, response) = try await URLSession.shared.data(for: request)
            try Self.checkHTTP(response)
        }
    }

    private static func checkHTTP(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse else { throw SyncError.networkError }
        switch http.statusCode {
        case 200: return
        case 401: throw SyncError.unauthorized
        default: throw SyncError.serverError
        }
    }

    // MARK: - Card ↔ Dictionary

    private static func applyRemote(_ dict: [String: Any], to card: Card) {
        card.en = dict["en"] as? String ?? ""
        card.zh = dict["zh"] as? String ?? ""
        card.example = dict["example"] as? String ?? ""
        card.usage = dict["usage"] as? String ?? ""
        card.sourceZh = dict["sourceZh"] as? String ?? ""
        card.sourceEn = dict["sourceEn"] as? String ?? ""
        // 注:云端 D1 仍有 scene 列(为了兼容老数据),iOS 不再使用,所以这里也不读
        card.createdAt = dict["createdAt"] as? Double ?? 0
        card.ease = dict["ease"] as? Double ?? 2.5
        card.interval = dict["interval"] as? Double ?? 0
        card.reps = (dict["reps"] as? Int) ?? Int(dict["reps"] as? Double ?? 0)
        card.due = dict["due"] as? Double ?? 0
        card.lastReview = dict["lastReview"] as? Double ?? 0
        card.isDeletedRaw = (dict["deleted"] as? Bool == true) ? 1 : 0
        card.updatedAt = dict["updatedAt"] as? Double ?? 0
        // FSRS 字段(旧服务端可能没这些 key,缺失时默认 0)
        card.stability = dict["stability"] as? Double ?? 0
        card.difficulty = dict["difficulty"] as? Double ?? 0
        card.state = (dict["state"] as? Int) ?? Int(dict["state"] as? Double ?? 0)
        card.lapses = (dict["lapses"] as? Int) ?? Int(dict["lapses"] as? Double ?? 0)
    }

    private static func cardFromRemote(_ dict: [String: Any]) -> Card {
        let card = Card(en: "", zh: "")
        card.id = dict["id"] as? String ?? card.id
        applyRemote(dict, to: card)
        return card
    }

    private static func cardToDict(_ card: Card) -> [String: Any] {
        [
            "id": card.id,
            "en": card.en,
            "zh": card.zh,
            "example": card.example,
            "usage": card.usage,
            "sourceZh": card.sourceZh,
            "sourceEn": card.sourceEn,
            // 注:不再发送 scene 字段(iOS 已删除场景功能)。云端 D1 列仍在,旧值不会丢
            "createdAt": card.createdAt,
            "ease": card.ease,
            "interval": card.interval,
            "reps": card.reps,
            "due": card.due,
            "lastReview": card.lastReview,
            "deleted": card.isDeletedRaw != 0,
            "updatedAt": card.updatedAt,
            "stability": card.stability,
            "difficulty": card.difficulty,
            "state": card.state,
            "lapses": card.lapses
        ]
    }

    enum SyncError: LocalizedError {
        case unauthorized
        case serverError
        case networkError

        var errorDescription: String? {
            switch self {
            case .unauthorized: "口令错误，请检查"
            case .serverError: "服务端错误"
            case .networkError: "网络连接失败"
            }
        }
    }
}
