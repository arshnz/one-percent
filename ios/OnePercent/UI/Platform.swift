import SwiftUI
#if os(iOS)
import UIKit
#else
import AppKit
#endif

// The seam between the iPhone and the Mac. The app is one codebase: the views
// are written once, and the handful of things that differ by platform — the
// clipboard, images, sharing, navigation-bar chrome, window sizing — go
// through here so the feature code doesn't have to care which it's on.

extension View {
    /// iPhone: a compact inline title. Mac: windows title themselves.
    @ViewBuilder func inlineTitle() -> some View {
        #if os(iOS)
        navigationBarTitleDisplayMode(.inline)
        #else
        self
        #endif
    }

    /// iPhone: hide the navigation bar on screens that draw their own header.
    @ViewBuilder func hidePhoneNavBar() -> some View {
        #if os(iOS)
        toolbar(.hidden, for: .navigationBar)
        #else
        self
        #endif
    }

    /// Mac: the tabs become a sidebar.
    @ViewBuilder func macSidebarTabs() -> some View {
        #if os(macOS)
        tabViewStyle(.sidebarAdaptable)
        #else
        self
        #endif
    }

    /// Mac: the screens were laid out for a phone, so keep them to a readable
    /// column in the middle of a wide window rather than stretched edge to edge.
    @ViewBuilder func macColumn(_ width: CGFloat = 760) -> some View {
        #if os(macOS)
        frame(maxWidth: width).frame(maxWidth: .infinity).background(Theme.bg)
        #else
        self
        #endif
    }

    /// Mac: sheets size to their content, which for a Form is too small to use.
    @ViewBuilder func macSheet(width: CGFloat, height: CGFloat) -> some View {
        #if os(macOS)
        frame(minWidth: width, idealWidth: width, minHeight: height, idealHeight: height)
        #else
        self
        #endif
    }
}

enum Clipboard {
    static var string: String? {
        get {
            #if os(iOS)
            UIPasteboard.general.string
            #else
            NSPasteboard.general.string(forType: .string)
            #endif
        }
        set {
            #if os(iOS)
            UIPasteboard.general.string = newValue
            #else
            NSPasteboard.general.clearContents()
            if let newValue { NSPasteboard.general.setString(newValue, forType: .string) }
            #endif
        }
    }
}

enum PlatformImage {
    static func image(_ data: Data) -> Image? {
        #if os(iOS)
        UIImage(data: data).map { Image(uiImage: $0) }
        #else
        NSImage(data: data).map { Image(nsImage: $0) }
        #endif
    }

    /// Re-encode as JPEG with the longest side at most `maxSide` points.
    static func downscale(_ data: Data, maxSide: CGFloat) -> Data {
        #if os(iOS)
        guard let img = UIImage(data: data) else { return data }
        let scale = min(1, maxSide / max(img.size.width, img.size.height))
        let size = CGSize(width: img.size.width * scale, height: img.size.height * scale)
        let out = UIGraphicsImageRenderer(size: size).image { _ in img.draw(in: CGRect(origin: .zero, size: size)) }
        return out.jpegData(compressionQuality: 0.8) ?? data
        #else
        guard let rep = NSBitmapImageRep(data: data) else { return data }
        let w = CGFloat(rep.pixelsWide), h = CGFloat(rep.pixelsHigh)
        let scale = min(1, maxSide / max(w, h))
        let size = NSSize(width: (w * scale).rounded(), height: (h * scale).rounded())
        guard let out = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ) else { return data }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: out)
        rep.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        return out.representation(using: .jpeg, properties: [.compressionFactor: 0.8]) ?? data
        #endif
    }
}

#if os(iOS)
/// The system share sheet.
struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}
#else
/// The Mac has no share sheet to present modally; offer the share menu, and
/// for a file a plain Save… as well.
struct ShareSheet: View {
    let items: [Any]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                if let url = item as? URL {
                    Text(url.lastPathComponent).font(.system(size: 13, weight: .medium))
                    HStack {
                        Button("Save…") { save(url) }.keyboardShortcut(.defaultAction)
                        ShareLink(item: url)
                    }
                } else if let text = item as? String {
                    HStack {
                        Button("Copy") { Clipboard.string = text; dismiss() }.keyboardShortcut(.defaultAction)
                        ShareLink(item: text)
                    }
                }
            }
            HStack { Spacer(); Button("Done") { dismiss() }.keyboardShortcut(.cancelAction) }
        }
        .padding(20)
        .frame(minWidth: 360)
    }

    private func save(_ url: URL) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = url.lastPathComponent
        panel.canCreateDirectories = true
        guard panel.runModal() == .OK, let dest = panel.url else { return }
        try? FileManager.default.removeItem(at: dest)
        try? FileManager.default.copyItem(at: url, to: dest)
        dismiss()
    }
}

/// The menu bar: new habit, settings, and a shortcut to each section.
struct MacCommands: Commands {
    let router: AppRouter

    var body: some Commands {
        CommandGroup(replacing: .newItem) {
            Button("New Habit") { router.architect = ArchitectSeed() }
                .keyboardShortcut("n")
        }
        CommandGroup(replacing: .appSettings) {
            Button("Settings…") { router.showSettings = true }
                .keyboardShortcut(",")
        }
        CommandMenu("Go") {
            Button("Today") { router.tab = .today }.keyboardShortcut("1")
            Button("Compass") { router.tab = .compass }.keyboardShortcut("2")
            Button("Learn") { router.tab = .learn }.keyboardShortcut("3")
            Button("Momentum") { router.tab = .momentum }.keyboardShortcut("4")
            Button("Body") { router.tab = .body }.keyboardShortcut("5")
        }
    }
}
#endif
