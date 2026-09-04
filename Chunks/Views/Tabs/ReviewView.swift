import SwiftUI
import SwiftData

/// 复习方向(全局偏好,存 UserDefaults)
enum ReviewDirection: String {
    case zhToEn  // 中→英(默认):正面中文,翻牌看英文
    case enToZh  // 英→中:正面英文,翻牌看中文

    var label: String {
        switch self {
        case .zhToEn: "中→英"
        case .enToZh: "英→中"
        }
    }
}

/// 每日队列上限:R<0.9 的卡再多也最多展示这么多张,余下顺延到下一天
private let DAILY_QUEUE_CAP = 30
private let MIN_CARDS_TO_START = 10

struct ReviewView: View {
    @Environment(CloudSyncService.self) private var syncService
    @Environment(\.modelContext) private var modelContext

    /// 取所有未删除卡(用来判断是否够开始 + 计算今日队列)
    @Query(filter: #Predicate<Card> { card in card.isDeletedRaw == 0 })
    private var allCards: [Card]

    @AppStorage("reviewDirection") private var directionRaw: String = ReviewDirection.zhToEn.rawValue

    @State private var session: ReviewSession?

    private var direction: ReviewDirection {
        ReviewDirection(rawValue: directionRaw) ?? .zhToEn
    }

    var body: some View {
        ZStack {
            NavigationStack {
                Group {
                    if allCards.count < MIN_CARDS_TO_START {
                        notEnoughView
                    } else if let session = session, !session.isFinished {
                        reviewingView(session: session)
                    } else {
                        homeView
                    }
                }
                .background(Color(.systemGroupedBackground))
                .navigationTitle("复习")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        directionToggle
                    }
                }
            }

            // 屏幕级光晕(在 NavigationStack 外层,覆盖整个 Tab 屏幕,
            // 不被 NavigationBar / SafeArea 遮挡)
            screenEdgeGlow
                .allowsHitTesting(false)
        }
    }

    // MARK: - 卡片库太小(卡片总数不够 MIN_CARDS_TO_START)

    private var notEnoughView: some View {
        ContentUnavailableView {
            Label("再多翻译几句", systemImage: "rectangle.stack.badge.plus")
        } description: {
            Text("攒够 \(MIN_CARDS_TO_START) 张卡片后开始记忆\n现在 \(allCards.count) / \(MIN_CARDS_TO_START)")
        }
    }

    // MARK: - 复习首页(没在复习中,显示概况和开始按钮)

    private var homeView: some View {
        ScrollView {
            VStack(spacing: 16) {
                statsCard

                let due = todayQueue()
                if due.isEmpty {
                    finishedTodayCard
                } else {
                    Button {
                        session = ReviewSession(cards: due)
                    } label: {
                        HStack {
                            Image(systemName: "play.fill")
                            Text("开始复习 · \(due.count) 张")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.accentColor)
                        .foregroundStyle(.white)
                        .font(.system(size: 17, weight: .semibold))
                        .cornerRadius(12)
                    }
                }
            }
            .padding(16)
        }
    }

    private var statsCard: some View {
        // 「待复习」= R<0.9 的卡数(统一新/旧卡,真实欠账,不被 DAILY_QUEUE_CAP 截断)
        let nowMs = now
        let due = allCards.filter { currentR(for: $0, nowMs: nowMs) < FSRSScheduler.desiredRetention }.count
        let total = allCards.count
        let mastered = allCards.filter { $0.state == 1 && $0.stability >= 30 }.count

        return HStack(spacing: 0) {
            statCell("待复习", "\(due)", color: due > 0 ? .red : .secondary)
            divider
            statCell("已熟练", "\(mastered)", color: mastered > 0 ? .green : .secondary)
            divider
            statCell("总数", "\(total)", color: .accentColor)
        }
        .padding(.vertical, 16)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }

    private func statCell(_ label: String, _ value: String, color: Color) -> some View {
        VStack(spacing: 4) {
            Text(value)
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(color)
            Text(label)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var divider: some View {
        Rectangle()
            .fill(Color(.separator))
            .frame(width: 0.5, height: 36)
    }

    private var finishedTodayCard: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 56))
                .foregroundStyle(Color.green)
            Text("今天的复习搞定了")
                .font(.system(size: 20, weight: .semibold))
            Text("明天再来 ✌")
                .font(.system(size: 14))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    // MARK: - 复习中(显示当前卡)

    @State private var swipeProgress: Double = 0  // -1...1,屏幕边缘光晕用

    private func reviewingView(session: ReviewSession) -> some View {
        VStack(spacing: 0) {
            Text("\(session.index + 1) / \(session.cards.count)")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .padding(.top, 8)

            SwipeableFlashcard(
                    card: session.currentCard,
                    direction: direction,
                    isFlipped: session.isFlipped,
                    swipeProgress: $swipeProgress,
                    onTap: {
                        if !session.isFlipped {
                            withAnimation(.easeInOut(duration: 0.45)) {
                                self.session?.isFlipped = true
                            }
                        }
                    },
                    onSwipeLeft: {
                        rate(.forgot)
                    },
                    onSwipeRight: {
                        rate(session.isFlipped ? .good : .easy)
                    }
                )
            .padding(20)

            Spacer(minLength: 0)
        }
    }

    /// 屏幕外的光源:扁平椭圆形,自然在卡片所在的水平条带上扩散
    /// 光源对齐到卡片的视觉中心(NavBar 之下 + Tab Bar 之上 的中点)
    private var screenEdgeGlow: some View {
        GeometryReader { geo in
            // 用户视觉中心:NavBar(~140pt 含大标题)和 Tab Bar(~90pt)之间的中点
            // 数学:y = 140 + (geo.height - 140 - 90) / 2
            //      = 140 + (geo.height - 230) / 2
            //      ≈ geo.height * 0.5 + 25
            // 经验值:屏幕中点稍微下移 25-40pt,在大多数 iPhone 尺寸下视觉对齐卡片中心
            let cardCenterY = geo.size.height / 2 + 30

            bulb(color: .red, intensity: swipeProgress < 0 ? abs(swipeProgress) : 0)
                .position(x: -500, y: cardCenterY)

            bulb(color: .green, intensity: swipeProgress > 0 ? swipeProgress : 0)
                .position(x: geo.size.width + 500, y: cardCenterY)
        }
        .ignoresSafeArea()
        .animation(nil, value: swipeProgress)
    }

    /// 扁椭圆光斑(横向延展,纵向收窄,自然不会延伸到顶部和底部)
    private func bulb(color: Color, intensity: Double) -> some View {
        Ellipse()
            .fill(
                RadialGradient(
                    colors: [
                        color.opacity(intensity * 0.85),
                        color.opacity(intensity * 0.50),
                        color.opacity(intensity * 0.22),
                        .clear
                    ],
                    center: .center,
                    startRadius: 0,
                    endRadius: 700
                )
            )
            .frame(width: 1400, height: 480)  // 更大灯,横向 1400 纵向 480
            .blur(radius: 70)
            .opacity(intensity > 0 ? 1 : 0)
    }

    // MARK: - 方向切换按钮(顶部右上角)

    private var directionToggle: some View {
        Button {
            directionRaw = direction == .zhToEn
                ? ReviewDirection.enToZh.rawValue
                : ReviewDirection.zhToEn.rawValue
        } label: {
            Text(direction.label)
                .font(.system(size: 14, weight: .medium))
        }
    }

    // MARK: - 业务逻辑

    private var now: Double { Date().timeIntervalSince1970 * 1000 }

    /// 今日队列:所有卡(新+旧)用统一记忆曲线算 R,挑 R<0.9 的,按 R 升序取前 DAILY_QUEUE_CAP 张
    /// 新卡用虚拟 stability(见 FSRSScheduler.currentRetrievability),刚翻译的 R≈1 不会进队列
    private func todayQueue() -> [Card] {
        let nowMs = now
        return allCards
            .map { ($0, currentR(for: $0, nowMs: nowMs)) }
            .filter { $0.1 < FSRSScheduler.desiredRetention }
            .sorted { $0.1 < $1.1 }
            .prefix(DAILY_QUEUE_CAP)
            .map { $0.0 }
    }

    /// 一张卡当前的 retrievability(用于排序和"待复习"计数)
    private func currentR(for card: Card, nowMs: Double) -> Double {
        FSRSScheduler.currentRetrievability(
            state: card.state,
            stability: card.stability,
            lastReviewMs: card.lastReview,
            createdAtMs: card.createdAt,
            nowMs: nowMs
        )
    }

    /// 评分:更新卡片的 FSRS 状态 + 写库 + 推同步 + 进入下一张
    private func rate(_ rating: Rating) {
        guard let session = session else { return }
        let card = session.currentCard

        // 第一次复习时智能初始化(把 SM-2 旧数据迁移到 FSRS)
        if card.state == 0 && card.stability == 0 && card.reps > 0 {
            let boot = FSRSScheduler.bootstrap(card: CardSnapshot(card: card))
            card.stability = boot.stability
            card.difficulty = boot.difficulty
            card.state = boot.state
        }

        let result = FSRSScheduler.schedule(card: CardSnapshot(card: card), rating: rating)
        card.stability = result.stability
        card.difficulty = result.difficulty
        card.state = result.state
        card.lapses = result.lapses
        card.due = result.dueMs
        card.lastReview = result.lastReviewMs
        card.updatedAt = result.updatedAtMs
        // 同步老 SM-2 字段(向前兼容,PWA 拉下来时仍然能正常显示)
        card.interval = result.intervalDays * FSRSScheduler.dayMs
        card.reps = (rating == .forgot) ? 0 : card.reps + 1

        try? modelContext.save()
        syncService.scheduleSync()

        withAnimation(.easeInOut(duration: 0.25)) {
            self.session?.isFlipped = false
            self.session?.advance()
        }
    }
}

// MARK: - Review Session(本次复习的状态)

@Observable
final class ReviewSession {
    let cards: [Card]
    var index: Int = 0
    var isFlipped: Bool = false

    init(cards: [Card]) {
        self.cards = cards
    }

    var currentCard: Card { cards[min(index, cards.count - 1)] }
    var isFinished: Bool { index >= cards.count }

    func advance() {
        index += 1
    }
}

// MARK: - 可滑动的闪卡(包装 FlashcardView,支持手势 + 翻牌)
//   行为:
//   - 任何状态都能左右滑(无翻牌前提)
//   - 翻牌前右滑 = easy(信心十足),翻牌后右滑 = good
//   - 任何状态左滑 = forgot
//   - 轻点 = 翻牌(只在未翻牌时生效)
//   - 翻牌前的滑动跟翻牌动作并存,不冲突 — 通过手势识别区分(短轻拍 vs 横向拖动)

private struct SwipeableFlashcard: View {
    let card: Card
    let direction: ReviewDirection
    let isFlipped: Bool
    @Binding var swipeProgress: Double  // -1...1,父级用来驱动屏幕边缘光晕
    let onTap: () -> Void
    let onSwipeLeft: () -> Void
    let onSwipeRight: () -> Void

    @State private var dragOffset: CGFloat = 0
    @State private var isExiting = false

    /// 划出阈值:滑超过这个距离松手就触发评分
    private let exitThreshold: CGFloat = 120

    var body: some View {
        FlashcardView(
            card: card,
            direction: direction,
            isFlipped: isFlipped,
            onTap: onTap
        )
        .offset(x: dragOffset)
        .rotationEffect(.degrees(Double(dragOffset) / 30), anchor: .bottom)
        .gesture(swipeGesture)
    }

    private var swipeGesture: some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                guard !isExiting else { return }
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > abs(dy) else {
                    dragOffset = 0
                    swipeProgress = 0
                    return
                }
                dragOffset = dx
                swipeProgress = Double(dx / exitThreshold).clamped(to: -1...1)
            }
            .onEnded { value in
                guard !isExiting else {
                    dragOffset = 0
                    swipeProgress = 0
                    return
                }
                let dx = value.translation.width
                let dy = value.translation.height
                guard abs(dx) > abs(dy) else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        dragOffset = 0
                        swipeProgress = 0
                    }
                    return
                }
                if dx <= -exitThreshold {
                    isExiting = true
                    withAnimation(.easeIn(duration: 0.18)) {
                        dragOffset = -800
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                        onSwipeLeft()
                        dragOffset = 0
                        swipeProgress = 0
                        isExiting = false
                    }
                } else if dx >= exitThreshold {
                    isExiting = true
                    withAnimation(.easeIn(duration: 0.18)) {
                        dragOffset = 800
                    }
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.18) {
                        onSwipeRight()
                        dragOffset = 0
                        swipeProgress = 0
                        isExiting = false
                    }
                } else {
                    withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                        dragOffset = 0
                        swipeProgress = 0
                    }
                }
            }
    }
}

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}

// MARK: - 闪卡视图(3D 翻转)

private struct FlashcardView: View {
    let card: Card
    let direction: ReviewDirection
    let isFlipped: Bool
    let onTap: () -> Void

    var body: some View {
        ZStack {
            cardSurface(content: { frontContent })
                .opacity(isFlipped ? 0 : 1)
                .rotation3DEffect(
                    .degrees(isFlipped ? 180 : 0),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.5
                )

            cardSurface(content: { backContent })
                .opacity(isFlipped ? 1 : 0)
                .rotation3DEffect(
                    .degrees(isFlipped ? 0 : -180),
                    axis: (x: 0, y: 1, z: 0),
                    perspective: 0.5
                )
        }
        .frame(maxWidth: .infinity)
        .frame(minHeight: 320)
        .contentShape(Rectangle())
        .onTapGesture { onTap() }
    }

    private func cardSurface<C: View>(@ViewBuilder content: () -> C) -> some View {
        VStack {
            content()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(28)
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: 16))  // 字超出卡片会被裁剪,不会溢出
    }

    // 正面:中→英 显示短语的中文释义;英→中 显示英文短语
    private var frontContent: some View {
        VStack(spacing: 16) {
            Spacer(minLength: 0)
            switch direction {
            case .zhToEn:
                Text(card.zh)
                    .font(.system(size: 26, weight: .medium))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            case .enToZh:
                Text(card.en)
                    .font(.system(size: 26, weight: .semibold))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
            Spacer(minLength: 0)
            Text("轻点查看答案")
                .font(.system(size: 13))
                .foregroundStyle(.tertiary)
        }
    }

    // 背面:显示对应答案 + 例句 + 来源(不滚动,跟正面一样固定布局)
    private var backContent: some View {
        VStack(spacing: 14) {
            Spacer(minLength: 0)

            switch direction {
            case .zhToEn:
                Text(card.en)
                    .font(.system(size: 26, weight: .semibold))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                Text(card.zh)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            case .enToZh:
                Text(card.zh)
                    .font(.system(size: 22, weight: .medium))
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                Text(card.en)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }

            if !card.example.isEmpty {
                Text("「\(card.example)」")
                    .font(.system(size: 14))
                    .italic()
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }

            if !card.sourceZh.isEmpty && card.sourceZh != card.zh {
                Text("来自:\(card.sourceZh)")
                    .font(.system(size: 12))
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            Button {
                SpeechService.shared.speak(card.en)
            } label: {
                Image(systemName: "speaker.wave.2.fill")
                    .font(.system(size: 20))
                    .foregroundStyle(Color.accentColor)
                    .frame(width: 40, height: 40)
            }
        }
    }
}
