import Foundation

/// FSRS (Free Spaced Repetition Scheduler) — Chunks 用 3 档隐式映射
///
/// FSRS 标准 4 档:Again/Hard/Good/Easy,grade 1/2/3/4
/// 我们用手势 + 是否翻牌隐式区分,UI 上仍然是"左滑/右滑"两个动作:
///
/// 行为                            FSRS grade
/// ─────────────────────────────────────────
/// 翻牌前右滑(我闭眼都记得)         4 (easy)
/// 翻牌后右滑(看了才想起来)         3 (good)
/// 翻牌后左滑(看了还是不会)         1 (forgot)
/// 翻牌前左滑(连看都懒得看)         1 (forgot)
///
/// 算法基于 FSRS-4.5 默认参数(见 https://expertium.github.io/Algorithm.html)
enum Rating: Int {
    case forgot = 1   // FSRS Again
    case mid = 2      // FSRS Hard(目前没用,保留扩展)
    case good = 3     // FSRS Good — 翻牌后右滑
    case easy = 4     // FSRS Easy — 翻牌前右滑(信心十足)

    /// 简化的 2 档对外别名(老代码兼容)
    static let remember = Rating.good

    var grade: Double { Double(rawValue) }
}

struct FSRSResult {
    let stability: Double
    let difficulty: Double
    let state: Int           // 0=new, 1=review
    let lapses: Int
    let dueMs: Double        // 下次到期时间(毫秒戳)
    let lastReviewMs: Double // 本次复习时间(毫秒戳)
    let updatedAtMs: Double  // 更新时间(同 lastReview)
    let intervalDays: Double // 本次到下次的间隔,用于 UI 预览
}

enum FSRSScheduler {
    // FSRS-4.5 默认 19 个学习参数(社区训练得到的"全人群最优")
    // 这些参数对个人不是最优的,但远好于自己拍脑袋。后期有大量数据可以训练个性化参数。
    static let W: [Double] = [
        0.40255, 1.18385, 3.173, 15.69105,
        7.1949, 0.5345, 1.4604, 0.0046,
        1.54575, 0.1192, 1.01925, 1.9395,
        0.11, 0.29605, 2.2698,
        0.2315, 2.9898,
        0.51655, 0.6621
    ]

    static let desiredRetention: Double = 0.9
    static let factor: Double = 19.0 / 81.0  // F
    static let decay: Double = -0.5          // C
    static let dayMs: Double = 24 * 3600 * 1000

    // MARK: - Public

    /// 给一张卡片评分,返回更新后的状态
    static func schedule(card: CardSnapshot, rating: Rating, now: Date = Date()) -> FSRSResult {
        let nowMs = now.timeIntervalSince1970 * 1000

        if card.state == 0 {
            // 首次复习:用 W[0..3] 初始化 stability,W[4..5] 初始化 difficulty
            return scheduleFirstReview(rating: rating, nowMs: nowMs)
        } else {
            return scheduleSubsequent(card: card, rating: rating, nowMs: nowMs)
        }
    }

    /// 智能初始化(已有 SM-2 数据 → FSRS):用 reps + interval 反推合理的 stability
    /// 第一次切到 FSRS 算法时,旧卡片的 (stability, difficulty, state) 都是 0,需要赋初值
    static func bootstrap(card: CardSnapshot) -> (stability: Double, difficulty: Double, state: Int) {
        if card.reps == 0 {
            // 完全新卡(从未复习过):state=0,以后第一次评分时初始化
            return (0, 0, 0)
        }
        // 学过的卡:把现有 interval(ms)折算成 stability(天),最少 1 天
        let stab = max(1.0, card.intervalMs / dayMs)
        // 难度从 SM-2 ease 反推:ease 越低难度越高
        // ease 范围 1.3-2.5 映射到 difficulty 8-3
        let diff = clamp(11.0 - 4.0 * (card.ease - 1.3), low: 1, high: 10)
        return (stab, diff, 1)
    }

    // MARK: - Internals

    private static func scheduleFirstReview(rating: Rating, nowMs: Double) -> FSRSResult {
        let g = Int(rating.grade)
        // 初始 stability(W[0..3]):忘了=W[0],hard=W[1],good=W[2],easy=W[3]
        // 2 档版只有 forgot/good,所以用 W[0] 和 W[2]
        let stability = clampStability(W[g - 1])  // grade=1 → W[0], grade=3 → W[2]
        // 初始 difficulty: D₀(G) = W[4] - exp(W[5]*(G-1)) + 1,clamp [1,10]
        let difficulty = clampDifficulty(W[4] - exp(W[5] * (rating.grade - 1)) + 1)

        let nextIntervalDays: Double
        let lapses: Int
        let state: Int

        if rating == .forgot {
            // 首次评 forgot:小间隔再来,通常 1 天内
            nextIntervalDays = max(1, intervalForStability(stability))
            lapses = 1
            state = 1
        } else {
            // 记住:进入 review 状态,按 stability 算下次
            nextIntervalDays = intervalForStability(stability)
            lapses = 0
            state = 1
        }

        let dueMs = nowMs + nextIntervalDays * dayMs
        return FSRSResult(
            stability: stability,
            difficulty: difficulty,
            state: state,
            lapses: lapses,
            dueMs: dueMs,
            lastReviewMs: nowMs,
            updatedAtMs: nowMs,
            intervalDays: nextIntervalDays
        )
    }

    private static func scheduleSubsequent(card: CardSnapshot, rating: Rating, nowMs: Double) -> FSRSResult {
        // 距上次复习的天数(用来算当前 retrievability R)
        let elapsedDays = max(0, (nowMs - card.lastReviewMs) / dayMs)
        let R = retrievability(elapsedDays: elapsedDays, stability: card.stability)

        // 1. 更新 difficulty(基于本次评分)
        // D' = D + (-W[6](G-3)) × ((10-D)/9)
        let dPrime = card.difficulty + (-W[6] * (rating.grade - 3)) * ((10 - card.difficulty) / 9)
        // 均值回归: D'' = W[7] × D₀(grade=3) + (1 - W[7]) × D'
        let d0Good = W[4] - exp(W[5] * (3 - 1)) + 1
        let newDifficulty = clampDifficulty(W[7] * d0Good + (1 - W[7]) * dPrime)

        let newStability: Double
        var newLapses = card.lapses

        if rating == .forgot {
            // 失败:S' = min(S_f, S),其中 S_f = D^(-W[12]) × ((S+1)^W[13] - 1) × e^(W[14](1-R)) × W[11]
            let sf = pow(card.difficulty, -W[12])
                * (pow(card.stability + 1, W[13]) - 1)
                * exp(W[14] * (1 - R))
                * W[11]
            newStability = clampStability(min(sf, card.stability))
            newLapses += 1
        } else {
            // 成功:S' = S × α
            // α = 1 + (11-D) × S^(-W[9]) × (e^(W[10](1-R)) - 1) × hard_penalty × easy_bonus × e^(W[8])
            // hard 档减系数 W[15],easy 档加系数 W[16],good/mid 中性
            let hardPenalty = (rating == .mid) ? W[15] : 1.0
            let easyBonus = (rating == .easy) ? W[16] : 1.0
            let alpha = 1
                + (11 - card.difficulty)
                * pow(card.stability, -W[9])
                * (exp(W[10] * (1 - R)) - 1)
                * hardPenalty
                * easyBonus
                * exp(W[8])
            newStability = clampStability(card.stability * alpha)
        }

        let nextIntervalDays = intervalForStability(newStability)
        let dueMs = nowMs + nextIntervalDays * dayMs

        return FSRSResult(
            stability: newStability,
            difficulty: newDifficulty,
            state: 1,
            lapses: newLapses,
            dueMs: dueMs,
            lastReviewMs: nowMs,
            updatedAtMs: nowMs,
            intervalDays: nextIntervalDays
        )
    }

    /// 当前 retrievability:R(t,S) = (1 + F * t / S)^C
    /// 公开给 ReviewView 用于今日队列排序("R 越低越该复习")
    static func retrievability(elapsedDays: Double, stability: Double) -> Double {
        guard stability > 0 else { return 1 }
        return pow(1 + factor * elapsedDays / stability, decay)
    }

    /// 一张卡当前的 retrievability(统一新旧卡)
    /// - 旧卡(state=1, stability>0):用 stability + lastReview
    /// - 新卡(state=0):用虚拟 stability = W[2](首次评 good 后 FSRS 给出的初始 S)+ createdAt
    ///   语义:"假如这张卡是 createdAt 那天评了 good,现在该记得多牢"
    static func currentRetrievability(
        state: Int,
        stability: Double,
        lastReviewMs: Double,
        createdAtMs: Double,
        nowMs: Double
    ) -> Double {
        let referenceMs: Double
        let s: Double
        if state == 1 && stability > 0 {
            referenceMs = lastReviewMs
            s = stability
        } else {
            referenceMs = createdAtMs
            s = W[2]
        }
        let elapsedDays = max(0, (nowMs - referenceMs) / dayMs)
        return retrievability(elapsedDays: elapsedDays, stability: s)
    }

    /// 由 stability 算下次间隔(天):I(R_d, S) = (S / F) * (R_d^(1/C) - 1)
    private static func intervalForStability(_ s: Double) -> Double {
        let raw = (s / factor) * (pow(desiredRetention, 1 / decay) - 1)
        // 至少 1 天,最多 36500 天(100 年,防 overflow)
        return clamp(raw, low: 1, high: 36500)
    }

    private static func clampStability(_ s: Double) -> Double {
        clamp(s, low: 0.01, high: 36500)
    }

    private static func clampDifficulty(_ d: Double) -> Double {
        clamp(d, low: 1, high: 10)
    }

    private static func clamp(_ v: Double, low: Double, high: Double) -> Double {
        min(max(v, low), high)
    }
}

/// 不可变 snapshot,避免直接传 SwiftData @Model 实例进算法(@Model 修改有副作用)
struct CardSnapshot {
    let stability: Double
    let difficulty: Double
    let state: Int
    let lapses: Int
    let lastReviewMs: Double
    let intervalMs: Double  // 旧 SM-2 字段,用于 bootstrap
    let ease: Double        // 旧 SM-2 字段,用于 bootstrap
    let reps: Int           // 旧 SM-2 字段,用于 bootstrap

    init(card: Card) {
        self.stability = card.stability
        self.difficulty = card.difficulty
        self.state = card.state
        self.lapses = card.lapses
        self.lastReviewMs = card.lastReview
        self.intervalMs = card.interval
        self.ease = card.ease
        self.reps = card.reps
    }
}

// MARK: - 间隔显示工具

enum IntervalFormatter {
    static func displayDays(_ days: Double) -> String {
        let d = Int(days.rounded())
        if d <= 1 { return "1 天后" }
        if d < 30 { return "\(d) 天后" }
        let m = Int((Double(d) / 30).rounded())
        if m < 12 { return "\(m) 个月后" }
        let y = Int((Double(d) / 365).rounded())
        return "\(y) 年后"
    }
}
