import Foundation
import AVFoundation

/// 朗读单词 / 例句的 TTS 服务
///
/// 解决两个用户痛点:
/// 1. 静音模式不读 — 默认的 AVAudioSession category 跟物理静音键联动。这里用
///    `.playback` + `.spokenAudio` + `.duckOthers/.interruptSpokenAudioAndMixWithOthers`,
///    像导航类 app 那样无视静音键,且会自动 duck 背景音乐、中断其他 spoken audio,
///    speech 结束后 deactivate session 让背景音乐恢复音量。
/// 2. 默认 voice 机械感重 — 自动挑系统已下载的最高质量英文 voice
///    (Premium > Enhanced > Default)。系统首装时只有 Default;Enhanced/Premium
///    需要用户在「设置 → 辅助功能 → 朗读内容 → 语音 → 英语」手动下载。
final class SpeechService: NSObject {
    static let shared = SpeechService()

    private let synth = AVSpeechSynthesizer()
    private var audioSessionConfigured = false

    /// 当前用于朗读的英文 voice(lazy:启动时不调,首次 speak 才挑)
    private(set) lazy var preferredEnglishVoice: AVSpeechSynthesisVoice? = pickBestEnglishVoice()

    override init() {
        super.init()
        synth.delegate = self
    }

    /// 朗读一段英文。重复调会打断上一次。
    func speak(_ text: String, rate: Float = AVSpeechUtteranceDefaultSpeechRate * 0.9) {
        configureAudioSessionIfNeeded()
        activateSession()

        let u = AVSpeechUtterance(string: text)
        u.voice = preferredEnglishVoice
        u.rate = rate
        synth.stopSpeaking(at: .immediate)
        synth.speak(u)
    }

    /// 用户从系统设置下载新 voice 后,回到 app 可调用此方法重新评估
    func refreshVoice() {
        preferredEnglishVoice = pickBestEnglishVoice()
    }

    /// 给设置页显示当前 voice 质量
    var preferredVoiceLabel: String {
        guard let v = preferredEnglishVoice else { return "未找到英文语音" }
        let quality: String
        switch v.quality {
        case .premium: quality = "高级"
        case .enhanced: quality = "增强"
        default: quality = "标准"
        }
        return "\(v.name) · \(quality)"
    }

    // MARK: - Audio session

    private func configureAudioSessionIfNeeded() {
        guard !audioSessionConfigured else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(
                .playback,
                mode: .spokenAudio,
                options: [.duckOthers, .interruptSpokenAudioAndMixWithOthers]
            )
            audioSessionConfigured = true
        } catch {
            // 配置失败 fallback 到系统默认行为(静音键仍会静音,但代码不崩)
            print("[SpeechService] audio session setCategory failed: \(error)")
        }
    }

    private func activateSession() {
        try? AVAudioSession.sharedInstance().setActive(true, options: [])
    }

    private func deactivateSession() {
        // .notifyOthersOnDeactivation:让被 duck 的音乐 app 知道可以恢复音量
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    // MARK: - Voice 选择

    private func pickBestEnglishVoice() -> AVSpeechSynthesisVoice? {
        let englishVoices = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") }

        // 同质量内偏好 en-US > en-GB > 其他(只是常见口语 vs 英式 vs 其他英语区)
        let regionPriority: (AVSpeechSynthesisVoice) -> Int = { v in
            switch v.language {
            case "en-US": return 0
            case "en-GB": return 1
            default: return 2
            }
        }

        if let premium = englishVoices
            .filter({ $0.quality == .premium })
            .min(by: { regionPriority($0) < regionPriority($1) }) {
            return premium
        }
        if let enhanced = englishVoices
            .filter({ $0.quality == .enhanced })
            .min(by: { regionPriority($0) < regionPriority($1) }) {
            return enhanced
        }
        return AVSpeechSynthesisVoice(language: "en-US")
            ?? englishVoices.first
            ?? AVSpeechSynthesisVoice(language: "en")
    }
}

extension SpeechService: AVSpeechSynthesizerDelegate {
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        deactivateSession()
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        deactivateSession()
    }
}
