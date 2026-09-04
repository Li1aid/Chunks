import SwiftUI
import SwiftData

struct TranslateView: View {
    @Environment(AIService.self) private var aiService
    @Environment(CloudSyncService.self) private var syncService
    @Environment(\.modelContext) private var modelContext

    // 用 @Query 拿所有未删除的卡片,从中提取已有 scene 列表给 prompt
    @Query(filter: #Predicate<Card> { card in card.isDeletedRaw == 0 })
    private var allCards: [Card]

    @State private var chineseInput = ""
    @State private var isTranslating = false
    @State private var result: TranslationResult?
    @State private var direction: AIService.Direction = .zhToEn
    @State private var savedInfo: SavedInfo?
    @State private var errorMessage: String?
    @FocusState private var inputFocused: Bool

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    inputCard
                    translateButton

                    if let error = errorMessage {
                        errorCard(error)
                    }

                    if let result = result {
                        resultArea(result: result)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("翻译")
        }
    }

    // MARK: - Subviews

    private var inputCard: some View {
        TextField("输入中文或英文", text: $chineseInput, axis: .vertical)
            .lineLimit(3...8)
            .font(.system(size: 17))
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground))
            .cornerRadius(12)
            .focused($inputFocused)
            .submitLabel(.return)
    }

    private var translateButton: some View {
        Button {
            Task { await translate() }
        } label: {
            HStack {
                if isTranslating {
                    ProgressView().tint(.white)
                    Text("翻译中…")
                } else {
                    Text("翻译")
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .background(canTranslate ? Color.accentColor : Color.gray.opacity(0.3))
            .foregroundStyle(.white)
            .font(.system(size: 17, weight: .semibold))
            .cornerRadius(12)
        }
        .disabled(!canTranslate)
    }

    private var canTranslate: Bool {
        !chineseInput.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        && !isTranslating
        && aiService.isConfigured
    }

    private func errorCard(_ message: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
            Text(message)
                .font(.system(size: 14))
            Spacer()
            Button("重试") {
                errorMessage = nil
                Task { await translate() }
            }
            .font(.system(size: 14, weight: .medium))
        }
        .padding(12)
        .background(Color.red.opacity(0.12))
        .foregroundStyle(.red)
        .cornerRadius(10)
    }

    @ViewBuilder
    private func resultArea(result: TranslationResult) -> some View {
        // 翻译结果卡 — EN→ZH 时不显示喇叭(中文 TTS 不是核心场景)
        HStack(alignment: .top, spacing: 8) {
            Text(result.translation)
                .font(.system(size: 19, weight: .medium))
                .frame(maxWidth: .infinity, alignment: .leading)
                .textSelection(.enabled)

            if direction == .zhToEn {
                Button {
                    SpeechService.shared.speak(result.translation)
                } label: {
                    Image(systemName: "speaker.wave.2.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(Color.accentColor)
                        .frame(width: 36, height: 36)
                }
            }
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)

        // 已保存横幅(根据保存/跳过的组合显示不同文案 + 颜色)
        if let info = savedInfo {
            savedBanner(info)
        }

        // 语块/生词列表
        VStack(alignment: .leading, spacing: 10) {
            Text(direction == .zhToEn ? "语块" : "生词")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 4)

            if result.phrases.isEmpty {
                Text(direction == .zhToEn
                     ? "这一句没有提取到值得记忆的语块,已保存整句卡"
                     : "这一句没有提取到值得记忆的生词,已保存整句卡")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 24)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(result.phrases.enumerated()), id: \.offset) { index, phrase in
                        VStack(alignment: .leading, spacing: 4) {
                            Text(phrase.en)
                                .font(.system(size: 17, weight: .medium))
                                .textSelection(.enabled)
                            Text(phrase.zh)
                                .font(.system(size: 14))
                                .foregroundStyle(.secondary)
                            if let example = phrase.example, !example.isEmpty {
                                Text(example)
                                    .font(.system(size: 13))
                                    .foregroundStyle(.tertiary)
                                    .italic()
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)

                        if index < result.phrases.count - 1 {
                            Divider().padding(.leading, 12)
                        }
                    }
                }
                .background(Color(.secondarySystemGroupedBackground))
                .cornerRadius(12)
            }
        }
    }

    // MARK: - Translate flow

    private func translate() async {
        let input = chineseInput.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !input.isEmpty else { return }

        guard aiService.isConfigured else {
            errorMessage = "请先在「设置」配置 Worker 地址和口令"
            return
        }

        inputFocused = false
        isTranslating = true
        errorMessage = nil
        result = nil
        savedInfo = nil

        do {
            let (res, dir) = try await aiService.translate(text: input)
            result = res
            direction = dir
            savedInfo = autoSave(input: input, result: res, direction: dir)
        } catch let error as AIService.AIError {
            errorMessage = error.errorDescription ?? "翻译失败"
        } catch {
            errorMessage = "网络连接失败"
        }

        isTranslating = false
    }

    /// 自动保存:
    /// - 有语块 → 只存语块卡(去重:同 en 已存在则跳过)
    /// - 没语块 → 兜底存整句卡
    /// 去重判定:对 en 字段做规范化(小写 + 去首尾空格和标点)后字符串相等
    /// 不管输入方向,卡片字段统一是 en=英文 / zh=中文
    private func autoSave(input: String, result: TranslationResult, direction: AIService.Direction) -> SavedInfo {
        // 整句的英文和中文(根据方向决定哪边是哪边)
        let sentenceEn: String
        let sentenceZh: String
        switch direction {
        case .zhToEn:
            sentenceEn = result.translation
            sentenceZh = input
        case .enToZh:
            sentenceEn = input
            sentenceZh = result.translation
        }

        let existingNormalized = Set(allCards.map { Self.normalizeEn($0.en) })

        var saved = 0
        var skipped = 0

        if result.phrases.isEmpty {
            let key = Self.normalizeEn(sentenceEn)
            if !key.isEmpty, existingNormalized.contains(key) {
                skipped = 1
            } else {
                let card = Card(
                    en: sentenceEn,
                    zh: sentenceZh,
                    example: "",
                    sourceZh: sentenceZh,
                    sourceEn: sentenceEn
                )
                modelContext.insert(card)
                saved = 1
            }
        } else {
            var batchSeen: Set<String> = []
            for phrase in result.phrases {
                let key = Self.normalizeEn(phrase.en)
                if key.isEmpty {
                    skipped += 1
                    continue
                }
                if existingNormalized.contains(key) || batchSeen.contains(key) {
                    skipped += 1
                    continue
                }
                batchSeen.insert(key)
                let card = Card(
                    en: phrase.en,
                    zh: phrase.zh,
                    example: phrase.example ?? "",
                    sourceZh: sentenceZh,
                    sourceEn: sentenceEn
                )
                modelContext.insert(card)
                saved += 1
            }
        }

        if saved > 0 {
            try? modelContext.save()
            syncService.scheduleSync()
        }

        return SavedInfo(saved: saved, skipped: skipped)
    }

    /// 规范化语块 en 用于去重比较:小写 + 折叠多空格 + 去首尾空格和标点
    /// 不做词形还原(让 AI 在 prompt 里输出原形)
    static func normalizeEn(_ s: String) -> String {
        let lowered = s.lowercased()
        // 折叠多余空格
        let collapsed = lowered.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        // 去首尾标点(不删除中间的撇号 / 连字符)
        let punctuation = CharacterSet(charactersIn: ".,;:!?\"'`()[]{}")
        return collapsed.trimmingCharacters(in: punctuation).trimmingCharacters(in: .whitespaces)
    }

    @ViewBuilder
    private func savedBanner(_ info: SavedInfo) -> some View {
        let (text, color) = bannerContent(info)
        HStack(spacing: 6) {
            Image(systemName: info.saved > 0 ? "checkmark.circle.fill" : "info.circle.fill")
            Text(text)
                .font(.system(size: 14, weight: .medium))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 10)
        .background(color.opacity(0.15))
        .foregroundStyle(color)
        .cornerRadius(10)
    }

    private func bannerContent(_ info: SavedInfo) -> (String, Color) {
        switch (info.saved, info.skipped) {
        case (0, 0):
            return ("已保存", .green)
        case (let s, 0):
            return ("已保存 \(s) 张", .green)
        case (0, _):
            return ("语块已存在", .secondary)
        case (let s, _):
            return ("已保存 \(s) 张,语块已存在", .green)
        }
    }
}

private struct SavedInfo {
    let saved: Int
    let skipped: Int
}
