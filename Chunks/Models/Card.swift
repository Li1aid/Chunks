import Foundation
import SwiftData

@Model
final class Card {
    #Unique<Card>([\.id])
    // 注意:不要给 isDeleted (Bool) 字段加 #Index,SwiftData 1.x 在 indexed Bool 字段上有"赋值不持久化"的 bug
    #Index<Card>([\.updatedAt], [\.due])

    @Attribute(.preserveValueOnDeletion)
    var id: String

    var en: String
    var zh: String
    var example: String
    var usage: String
    var sourceZh: String
    var sourceEn: String

    var createdAt: Double

    // === SM-2 旧字段(保留兼容,FSRS 不用)===
    var ease: Double
    var interval: Double
    var reps: Int
    var due: Double
    var lastReview: Double

    // === 软删除(Bool 用 Int 存储,绕过 SwiftData bug)===
    var isDeletedRaw: Int

    // === 同步 ===
    var updatedAt: Double

    // === FSRS 字段(2026-05-08 新增)===
    /// 稳定性(天):间隔多少天后用户记得概率降到 90%。新卡 = 0
    var stability: Double = 0
    /// 难度 1-10,初始按首次评分计算
    var difficulty: Double = 0
    /// 0=new(从未学过) / 1=review(学过)。简化版没有 learning 中间态
    var state: Int = 0
    /// 失败次数(忘了的次数)
    var lapses: Int = 0

    var isDeleted: Bool {
        get { isDeletedRaw != 0 }
        set { isDeletedRaw = newValue ? 1 : 0 }
    }

    init(
        en: String,
        zh: String,
        example: String = "",
        usage: String = "",
        sourceZh: String = "",
        sourceEn: String = "",
        createdAt: Double? = nil,
        ease: Double = 2.5,
        interval: Double = 0,
        reps: Int = 0,
        due: Double? = nil,
        lastReview: Double = 0,
        isDeleted: Bool = false,
        updatedAt: Double? = nil,
        stability: Double = 0,
        difficulty: Double = 0,
        state: Int = 0,
        lapses: Int = 0
    ) {
        let now = Date().timeIntervalSince1970 * 1000
        self.id = Self.generateID()
        self.en = en
        self.zh = zh
        self.example = example
        self.usage = usage
        self.sourceZh = sourceZh
        self.sourceEn = sourceEn
        self.createdAt = createdAt ?? now
        self.ease = ease
        self.interval = interval
        self.reps = reps
        self.due = due ?? now
        self.lastReview = lastReview
        self.isDeletedRaw = isDeleted ? 1 : 0
        self.updatedAt = updatedAt ?? now
        self.stability = stability
        self.difficulty = difficulty
        self.state = state
        self.lapses = lapses
    }

    private static func generateID() -> String {
        let ts = Int(Date().timeIntervalSince1970 * 1000)
        let rand = String((0..<6).map { _ in "abcdefghijklmnopqrstuvwxyz0123456789".randomElement()! })
        return "\(ts)-\(rand)"
    }
}
