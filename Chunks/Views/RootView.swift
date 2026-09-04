import SwiftUI

enum AppTab: String, CaseIterable {
    case translate
    case library
    case review
    case settings

    var title: String {
        switch self {
        case .translate: "翻译"
        case .library: "卡片"
        case .review: "复习"
        case .settings: "设置"
        }
    }

    var icon: String {
        switch self {
        case .translate: "character.bubble"
        case .library: "rectangle.stack"
        case .review: "brain.head.profile"
        case .settings: "gearshape"
        }
    }
}

struct RootView: View {
    @State private var selectedTab: AppTab = .translate
    @Environment(\.scenePhase) private var scenePhase
    @Environment(CloudSyncService.self) private var syncService

    var body: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases, id: \.self) { tab in
                Tab(tab.title, systemImage: tab.icon, value: tab) {
                    switch tab {
                    case .translate: TranslateView()
                    case .library: LibraryView()
                    case .review: ReviewView()
                    case .settings: SettingsView()
                    }
                }
            }
        }
        .task {
            syncService.scheduleSync(after: 0.8)
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                syncService.scheduleSync(after: 0.5)
            }
        }
    }
}
