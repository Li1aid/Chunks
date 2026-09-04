import Foundation

// MARK: - 数据结构

struct TranslationResult: Codable {
    let translation: String
    let phrases: [Phrase]

    struct Phrase: Codable {
        let en: String
        let zh: String
        let example: String?
    }
}

// MARK: - Provider

/// AI 提供方 — 决定用哪家的 API
enum AIProvider: String, CaseIterable {
    case anthropic   // Claude (海外默认)
    case deepseek    // DeepSeek (国区默认)

    var displayName: String {
        switch self {
        case .anthropic: "Claude"
        case .deepseek: "DeepSeek"
        }
    }

    var defaultModel: String {
        switch self {
        case .anthropic: "claude-sonnet-4-6"
        case .deepseek: "deepseek-chat"
        }
    }

    /// 该 provider 支持的可选模型列表
    var availableModels: [(id: String, label: String)] {
        switch self {
        case .anthropic:
            return [
                ("claude-sonnet-4-6", "Sonnet 4.6"),
                ("claude-opus-4-7", "Opus 4.7"),
                ("claude-haiku-4-5-20251001", "Haiku 4.5")
            ]
        case .deepseek:
            return [
                ("deepseek-chat", "DeepSeek Chat"),
                ("deepseek-reasoner", "DeepSeek Reasoner")
            ]
        }
    }

    /// 根据 Locale.region 推荐默认 provider
    /// 中国大陆 → DeepSeek,其他 → Anthropic
    static var defaultForCurrentRegion: AIProvider {
        let region = Locale.current.region?.identifier ?? ""
        return region == "CN" ? .deepseek : .anthropic
    }
}

// MARK: - AIService

@Observable
final class AIService {
    // 配置都从 UserDefaults / Keychain 读,跟 CloudSyncService 共享
    private var workerURL: String {
        let raw = UserDefaults.standard.string(forKey: "workerURL") ?? ""
        return raw.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }
    private var appToken: String {
        KeychainHelper.read(key: "appToken") ?? ""
    }

    /// 当前 provider(用户选择 / 首次启动按地区设)
    var provider: AIProvider {
        let raw = UserDefaults.standard.string(forKey: "aiProvider") ?? ""
        return AIProvider(rawValue: raw) ?? AIProvider.defaultForCurrentRegion
    }

    /// 当前模型(根据 provider 不同 key 不同)
    var model: String {
        let key = modelStorageKey(for: provider)
        return UserDefaults.standard.string(forKey: key) ?? provider.defaultModel
    }

    var isConfigured: Bool { !workerURL.isEmpty && !appToken.isEmpty }

    /// UserDefaults 里"当前 provider 选了哪个模型"的键
    static func modelStorageKey(for provider: AIProvider) -> String {
        "aiModel_\(provider.rawValue)"
    }
    private func modelStorageKey(for provider: AIProvider) -> String {
        Self.modelStorageKey(for: provider)
    }

    // MARK: - 翻译入口(provider 无关)

    /// 翻译方向。用输入是否含中文字符自动判定。
    enum Direction {
        case zhToEn   // 输入中文 → 输出英文
        case enToZh   // 输入英文 → 输出中文
    }

    /// 自动检测方向:输入里有任意一个中文字符就当中文翻
    static func detectDirection(_ text: String) -> Direction {
        for scalar in text.unicodeScalars {
            // CJK 统一汉字 + 扩展 A
            if (0x4E00...0x9FFF).contains(scalar.value) || (0x3400...0x4DBF).contains(scalar.value) {
                return .zhToEn
            }
        }
        return .enToZh
    }

    /// 翻译入口:自动检测方向并调用对应 prompt
    func translate(text: String) async throws -> (TranslationResult, Direction) {
        guard isConfigured else { throw AIError.notConfigured }

        let direction = Self.detectDirection(text)
        let system = Self.buildTranslateSystemPrompt(direction: direction)
        let userMessage: String
        switch direction {
        case .zhToEn: userMessage = "中文: \(text)"
        case .enToZh: userMessage = "English: \(text)"
        }

        let responseText: String
        switch provider {
        case .anthropic:
            responseText = try await callAnthropic(system: system, user: userMessage)
        case .deepseek:
            responseText = try await callDeepSeek(system: system, user: userMessage)
        }
        return (try parseTranslationJSON(responseText), direction)
    }

    // MARK: - Anthropic 调用

    private func callAnthropic(system: String, user: String, maxTokens: Int = 1500) async throws -> String {
        let url = URL(string: "\(workerURL)/v1/messages")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(appToken, forHTTPHeaderField: "x-app-token")
        request.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")

        let body: [String: Any] = [
            "model": model,
            "max_tokens": maxTokens,
            "system": system,
            "messages": [["role": "user", "content": user]]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw AIError.apiError
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let content = json["content"] as? [[String: Any]] ?? []
        let texts = content.compactMap { block -> String? in
            guard block["type"] as? String == "text" else { return nil }
            return block["text"] as? String
        }
        return texts.joined(separator: "\n")
    }

    // MARK: - DeepSeek 调用(OpenAI 兼容协议)

    private func callDeepSeek(system: String, user: String, maxTokens: Int = 2000) async throws -> String {
        let url = URL(string: "\(workerURL)/v1/chat/completions")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(appToken, forHTTPHeaderField: "x-app-token")

        // DeepSeek 用 OpenAI 协议:system 也放 messages 数组里
        let body: [String: Any] = [
            "model": model,
            "max_tokens": maxTokens,
            "messages": [
                ["role": "system", "content": system],
                ["role": "user", "content": user]
            ],
            // 让 DeepSeek 输出严格 JSON,跳过它默认的 markdown 包裹
            "response_format": ["type": "json_object"]
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw AIError.apiError
        }

        let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
        let choices = json["choices"] as? [[String: Any]] ?? []
        guard let firstChoice = choices.first,
              let message = firstChoice["message"] as? [String: Any],
              let content = message["content"] as? String else {
            throw AIError.parseError
        }
        return content
    }

    // MARK: - JSON 解析

    private func parseTranslationJSON(_ text: String) throws -> TranslationResult {
        var cleaned = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("```") {
            cleaned = cleaned.replacingOccurrences(of: "^```(?:json)?\\s*", with: "", options: .regularExpression)
            cleaned = cleaned.replacingOccurrences(of: "\\s*```$", with: "", options: .regularExpression)
        }

        if let data = cleaned.data(using: .utf8),
           let result = try? JSONDecoder().decode(TranslationResult.self, from: data) {
            return result
        }

        if let range = cleaned.range(of: "\\{[\\s\\S]*\\}", options: .regularExpression),
           let data = String(cleaned[range]).data(using: .utf8) {
            return try JSONDecoder().decode(TranslationResult.self, from: data)
        }

        throw AIError.parseError
    }

    // MARK: - System Prompt

    static func buildTranslateSystemPrompt(direction: Direction) -> String {
        switch direction {
        case .zhToEn:
            return Self.zhToEnPrompt
        case .enToZh:
            return Self.enToZhPrompt
        }
    }

    private static let zhToEnPrompt: String = """
    你是一个英文口语翻译引擎。

    # 核心规则(必须严格遵守)
    1. 不输出任何废话、解释、寒暄、前缀、后缀
    2. 输出最自然、最地道的英文 —— 母语者真的会这么说,不是字面翻译
    3. 如果用户的中文不完整、有歧义、或语气模糊,你要根据语境猜测最合理的完整意思再翻译,不要反问、不要要求澄清
    4. 翻译风格默认是日常口语(spoken English),除非用户内容明显是书面/正式场景
    5. 语气、情绪、潜台词都要翻出来,不要只翻字面

    # 同时提取词块(chunk-based learning)
    从你给的英文翻译中,提取 1-4 个值得记忆的"词块/短语/生活名词":
    - **短语级搭配**:固定表达、习语、口语化短语、地道介词搭配
      例:"make up one's mind", "figure out", "get back from"
    - **生活名词**:母语者日常会用、但中级英语学习者可能不熟的具体名词
      例:gate, boom, curb, ledge, hinge, latch, vent, rim, chute
    - **不要选**:
      - 太基础的词(car, apple, book, water, table, I am, go to, very good)
      - 抽象概念词(idea, situation, concept, thing)
      - 专有名词(Apple, iPhone, New York)
      - 冠词/介词/连词单独出现
    - 如果整句都很基础没什么可提取的,phrases 数组可以为空

    ## 词块输出格式(关键!跨翻译保持一致以便去重)
    每个语块的 `en` 字段必须用**词典原形**输出,不要带具体语境的词形/代词:
    - 动词用**原形**(不要加 -ed / -ing / 第三人称单数 -s):
      ✅ "figure out"        ❌ "figured out" / "figuring out"
      ✅ "get back from"     ❌ "got back from" / "getting back from"
      ✅ "make up one's mind" ❌ "made up his mind" / "made up your mind"
    - 涉及人称代词(my/your/his/her/our/their)的固定搭配,统一用 **one's**(物主)或 **sb**(宾格):
      ✅ "make up one's mind"   ❌ "make up your mind"
      ✅ "lose sb's temper"     ❌ "lose his temper"
      ✅ "give sb a hand"       ❌ "give me a hand"
    - 名词用**单数原形**(不要复数 -s):✅ "curb"  ❌ "curbs"
    - 例句(`example` 字段)里**仍然用真实代词和真实形态**,保持自然
    - 输出全小写,除非是固有专名(如 Apple / iPhone)
    - 不带句末标点

    # 输出格式
    严格输出 JSON,不要任何 markdown 代码块、不要任何解释文字:
    {
      "translation": "最自然的英文翻译",
      "phrases": [
        {"en": "短语或名词", "zh": "中文释义", "example": "一个自然的英文例句"}
      ]
    }
    """

    private static let enToZhPrompt: String = """
    你是一个英文 → 中文翻译引擎,服务于中文母语的英语学习者。

    # 核心规则(必须严格遵守)
    1. 不输出任何废话、解释、寒暄、前缀、后缀
    2. 输出最自然的中文翻译 —— 中文母语者真的会这么说,不是字面对译
    3. 如果输入的英文有歧义,选最常见的解读翻译,不要反问
    4. 翻译风格默认匹配原文(口语 → 口语,书面 → 书面)

    # 同时提取生词(chunk-based learning)
    从用户输入的**英文原文**中,提取 1-4 个学习者值得记忆的"词块/短语/生活名词":
    - **短语级搭配**:固定表达、习语、口语化短语、地道介词搭配
      例:"make up one's mind", "figure out", "get back from"
    - **生活名词**:母语者日常会用、但中级英语学习者可能不熟的具体名词
      例:gate, boom, curb, ledge, hinge, latch, vent, rim, chute
    - **不要选**:
      - 太基础的词(car, apple, book, water, table, I am, go to, very good)
      - 抽象概念词(idea, situation, concept, thing)
      - 专有名词(Apple, iPhone, New York)
      - 冠词/介词/连词单独出现
    - 如果整句都很基础没什么可提取的,phrases 数组可以为空

    ## 词块输出格式(关键!跨翻译保持一致以便去重)
    每个语块的 `en` 字段必须用**词典原形**输出,不要照搬原文里的词形:
    - 动词用**原形**(不要加 -ed / -ing / 第三人称单数 -s):
      ✅ "figure out"        ❌ "figured out" / "figuring out"
      ✅ "make up one's mind" ❌ "made up his mind"
    - 涉及人称代词的固定搭配统一用 **one's** 或 **sb**:
      ✅ "make up one's mind"   ❌ "make up your mind"
      ✅ "give sb a hand"       ❌ "give me a hand"
    - 名词用**单数原形**(不要复数 -s):✅ "curb"  ❌ "curbs"
    - 例句(`example` 字段)用真实代词和真实形态,保持自然 —— 可以直接用原文里那一句,也可以另造一个
    - 输出全小写,除非是固有专名

    # 输出格式
    严格输出 JSON,不要任何 markdown 代码块、不要任何解释文字。
    `translation` 字段是整句的中文翻译。
    {
      "translation": "整句的中文翻译",
      "phrases": [
        {"en": "短语或名词", "zh": "中文释义", "example": "一个自然的英文例句"}
      ]
    }
    """

    enum AIError: LocalizedError {
        case notConfigured
        case apiError
        case parseError

        var errorDescription: String? {
            switch self {
            case .notConfigured: "请先在「设置」配置 Worker 地址和口令"
            case .apiError: "AI 接口请求失败"
            case .parseError: "AI 返回格式异常,请重试"
            }
        }
    }
}
