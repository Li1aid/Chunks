import SwiftUI
import SwiftData

@main
struct ChunksApp: App {
    let container: ModelContainer
    @State private var syncService: CloudSyncService
    @State private var aiService: AIService

    init() {
        let container = try! ModelContainer(for: Card.self)
        self.container = container
        self._syncService = State(wrappedValue: CloudSyncService(container: container))
        self._aiService = State(wrappedValue: AIService())
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(syncService)
                .environment(aiService)
        }
        .modelContainer(container)
    }
}
