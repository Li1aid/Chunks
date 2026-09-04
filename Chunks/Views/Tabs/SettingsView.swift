import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(CloudSyncService.self) private var syncService
    @Environment(AIService.self) private var aiService
    @Query(filter: #Predicate<Card> { card in card.isDeletedRaw == 0 })
    private var visibleCards: [Card]

    @State private var urlInput = ""
    @State private var tokenInput = ""
    @State private var showVoiceHint = false
    @FocusState private var inputFocused: Bool

    // Provider 跟模型(分开存,各自 UserDefaults key)
    @AppStorage("aiProvider") private var providerRaw: String = AIProvider.defaultForCurrentRegion.rawValue
    @AppStorage("aiModel_anthropic") private var anthropicModel: String = "claude-sonnet-4-6"
    @AppStorage("aiModel_deepseek") private var deepseekModel: String = "deepseek-chat"

    @AppStorage("reviewDirection") private var directionRaw: String = ReviewDirection.zhToEn.rawValue

    private var provider: AIProvider {
        AIProvider(rawValue: providerRaw) ?? AIProvider.defaultForCurrentRegion
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("服务器") {
                    TextField(urlPlaceholder, text: $urlInput)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .focused($inputFocused)

                    SecureField(tokenPlaceholder, text: $tokenInput)
                        .textInputAutocapitalization(.never)
                        .focused($inputFocused)

                    Button("保存") { save() }
                }

                Section {
                    Picker("引擎", selection: $providerRaw) {
                        ForEach(AIProvider.allCases, id: \.rawValue) { p in
                            Text(p.displayName).tag(p.rawValue)
                        }
                    }

                    // 当前 provider 对应的模型选择
                    Picker("模型", selection: currentModelBinding) {
                        ForEach(provider.availableModels, id: \.id) { m in
                            Text(m.label).tag(m.id)
                        }
                    }
                } header: {
                    Text("AI")
                } footer: {
                    Text(providerFooter)
                }

                Section("云同步") {
                    LabeledContent("状态") {
                        Text(syncService.syncStatus.displayText)
                            .foregroundStyle(.secondary)
                    }

                    Button("立即同步") {
                        Task { await syncService.syncNow() }
                    }
                    .disabled(!syncService.isConfigured || syncService.syncStatus == .syncing)

                    Button("重置同步", role: .destructive) {
                        Task { await syncService.resetSync() }
                    }
                    .disabled(!syncService.isConfigured || syncService.syncStatus == .syncing)
                }

                Section("复习") {
                    Picker("方向", selection: $directionRaw) {
                        Text("中 → 英").tag(ReviewDirection.zhToEn.rawValue)
                        Text("英 → 中").tag(ReviewDirection.enToZh.rawValue)
                    }
                }

                Section {
                    LabeledContent("当前语音") {
                        Text(SpeechService.shared.preferredVoiceLabel)
                            .foregroundStyle(.secondary)
                    }
                    Button("下载更自然的语音…") {
                        showVoiceHint = true
                    }
                } header: {
                    Text("语音")
                } footer: {
                    Text("默认「标准」声音机械感重。下载「增强」或「高级」voice 后回到 Chunks 自动启用。")
                }

                Section("数据") {
                    LabeledContent("总卡片数") {
                        Text("\(visibleCards.count)")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("设置")
            .alert("下载更自然的英文语音", isPresented: $showVoiceHint) {
                Button("刷新当前语音") {
                    SpeechService.shared.refreshVoice()
                }
                Button("好的", role: .cancel) { }
            } message: {
                Text("iOS 不允许 app 直接跳到语音下载页,需要你手动走一下:\n\n设置 → 辅助功能 → 朗读内容 → 语音 → 英语\n\n选「高级」或「增强」标记的 voice,点云下载图标。下载完回到 Chunks 点「刷新当前语音」即可生效。")
            }
        }
    }

    /// 根据当前 provider 返回对应模型的 binding,Picker 切换 provider 时模型 Picker 自动重新绑定
    private var currentModelBinding: Binding<String> {
        switch provider {
        case .anthropic: return $anthropicModel
        case .deepseek: return $deepseekModel
        }
    }

    private var providerFooter: String {
        switch provider {
        case .anthropic: "海外用户推荐 Claude,翻译质量最好。"
        case .deepseek: "国内访问更稳定,价格更友好。"
        }
    }

    private var urlPlaceholder: String {
        let saved = UserDefaults.standard.string(forKey: "workerURL") ?? ""
        return saved.isEmpty ? "https://...workers.dev" : saved
    }

    private var tokenPlaceholder: String {
        if let token = KeychainHelper.read(key: "appToken"), !token.isEmpty {
            return "已保存 ····\(String(token.suffix(4)))"
        }
        return "输入口令"
    }

    private func save() {
        inputFocused = false

        let url = urlInput
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        if !url.isEmpty {
            UserDefaults.standard.set(url, forKey: "workerURL")
        }

        let token = tokenInput.trimmingCharacters(in: .whitespacesAndNewlines)
        if !token.isEmpty {
            KeychainHelper.write(key: "appToken", value: token)
        }

        urlInput = ""
        tokenInput = ""

        syncService.refreshConfig()
        if syncService.isConfigured {
            syncService.scheduleSync(after: 0.3)
        }
    }
}
