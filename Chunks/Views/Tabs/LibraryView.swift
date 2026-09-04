import SwiftUI
import SwiftData

struct LibraryView: View {
    @Environment(CloudSyncService.self) private var syncService
    @Query(
        filter: #Predicate<Card> { card in card.isDeletedRaw == 0 },
        sort: \Card.createdAt,
        order: .reverse
    )
    private var cards: [Card]

    @State private var searchText = ""

    private var filteredCards: [Card] {
        guard !searchText.isEmpty else { return cards }
        let q = searchText.lowercased()
        return cards.filter { card in
            card.en.lowercased().contains(q)
            || card.zh.lowercased().contains(q)
            || card.example.lowercased().contains(q)
        }
    }

    var body: some View {
        NavigationStack {
            Group {
                if filteredCards.isEmpty {
                    ContentUnavailableView(
                        searchText.isEmpty ? "还没有卡片" : "没有匹配的卡片",
                        systemImage: searchText.isEmpty ? "rectangle.stack" : "magnifyingglass",
                        description: searchText.isEmpty
                            ? Text("先去翻译一句中文")
                            : Text("试试其他关键词")
                    )
                } else {
                    List {
                        ForEach(filteredCards, id: \.id) { card in
                            CardRow(card: card)
                                .swipeActions(edge: .trailing, allowsFullSwipe: true) {
                                    Button(role: .destructive) {
                                        syncService.softDeleteCard(id: card.id)
                                    } label: {
                                        Label("删除", systemImage: "trash")
                                    }
                                }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("卡片")
            .searchable(text: $searchText, prompt: "搜索卡片")
        }
    }

}

// MARK: - Card Row

private struct CardRow: View {
    let card: Card

    private static let day: Double = 24 * 3600 * 1000

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(card.en)
                .font(.system(size: 17, weight: .medium))

            Text(card.zh)
                .font(.system(size: 14))
                .foregroundStyle(.secondary)

            HStack {
                Text("复习 \(card.reps) 次")
                    .font(.caption)
                    .foregroundStyle(.secondary)

                Spacer()

                Text(dueText)
                    .font(.caption)
                    .foregroundStyle(dueColor)
            }
        }
        .padding(.vertical, 2)
    }

    private var dueText: String {
        let now = Date().timeIntervalSince1970 * 1000
        let dueIn = card.due - now

        if card.reps >= 5 && card.interval > 30 * Self.day {
            return "已熟练"
        }
        if dueIn <= 0 {
            return "今日待复习"
        }

        let days = Int(round(dueIn / Self.day))
        if days < 30 {
            return "\(days) 天后"
        }
        let months = Int(round(Double(days) / 30))
        return "\(months) 个月后"
    }

    private var dueColor: Color {
        let now = Date().timeIntervalSince1970 * 1000
        let dueIn = card.due - now

        if card.reps >= 5 && card.interval > 30 * Self.day {
            return .green
        }
        if dueIn <= 0 {
            return .red
        }
        if dueIn < 2 * Self.day {
            return .orange
        }
        return .secondary
    }
}
