import Foundation

/// Converts an Evernote note body (ENML, Evernote's XHTML) into Amber Notes markdown, the way
/// RichTextToMarkdown converts Apple Notes: headings, bold, italic, underline, strikethrough,
/// links, nested bulleted and numbered lists, checklists (old `<en-todo>` and Evernote 10's
/// `--en-todo` lists), tables, code blocks, quotes and rules. Attachments go on lines of their
/// own where the body placed them. Encrypted sections can't be opened and leave a marked line.
enum ENMLToMarkdown {
    struct Result: Equatable {
        var markdown: String
        /// `<en-crypt>` sections, each replaced by `encryptedLine`.
        var encrypted = 0
        /// Hashes of the attachments the body placed.
        var placed: [String] = []
        /// `<en-media>` whose file wasn't in the export.
        var missing = 0
    }

    static let encryptedLine = "> Encrypted in Evernote. Open this note in Evernote to read this part."

    /// `media` turns an attachment's hash into its markdown line, or nil if there's no such file.
    static func convert(_ enml: String, media: @escaping (String) -> String?) -> Result {
        guard let root = DOM.parse(enml) else {
            // Not well-formed even after cleanup: keep the words, lose the formatting.
            return Result(markdown: plainText(enml))
        }
        var r = Renderer(media: media)
        r.blocks(root.children)
        r.flush()
        return Result(markdown: r.finished(), encrypted: r.encrypted, placed: r.placed, missing: r.missing)
    }

    /// Text with the tags taken out, one line per block, for a body that won't parse.
    static func plainText(_ s: String) -> String {
        var t = s.replacingOccurrences(of: #"<!\[CDATA\[|\]\]>|<\?xml[^>]*\?>|<!DOCTYPE[^>]*>"#, with: "", options: .regularExpression)
        t = t.replacingOccurrences(of: #"<(br|/div|/p|/li|/h[1-6]|/tr)[^>]*>"#, with: "\n", options: [.regularExpression, .caseInsensitive])
        t = t.replacingOccurrences(of: #"<[^>]+>"#, with: "", options: .regularExpression)
        t = DOM.decodeEntities(t)
        return t.components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
            .reduce(into: [String]()) { out, l in if !(l.isEmpty && (out.last?.isEmpty ?? true)) { out.append(l) } }
            .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // MARK: Rendering

    /// Characters that never occur in a note, marking things inside a line until it's written:
    /// a checkbox (followed by "x" or " ") and an attachment line.
    fileprivate static let todoMark: Character = "\u{E000}"
    fileprivate static let mediaMark: Character = "\u{E001}"

    fileprivate struct Renderer {
        let media: (String) -> String?
        var lines: [String] = []
        var buffer = ""
        var encrypted = 0
        var placed: [String] = []
        var missing = 0

        init(media: @escaping (String) -> String?) { self.media = media }

        // MARK: Blocks

        mutating func blocks(_ children: [DOM.Child]) {
            for child in children {
                switch child {
                case .text(let t): buffer += RichTextToMarkdown.escape(Self.collapse(t))
                case .element(let e): element(e)
                }
            }
        }

        mutating func element(_ e: DOM.Element) {
            switch e.name {
            case "en-note", "body", "html", "center", "section", "article", "header", "footer", "main", "nav", "aside", "figure", "dl":
                flush(); blocks(e.children); flush()
            case "div" where e.isCodeBlock, "pre":
                flush(); code(e)
            case "div", "dt", "dd", "address", "figcaption", "summary", "details":
                flush()
                if e.isBlank { lines.append("") } else { blocks(e.children); flush() }
            case "p":
                flush()
                if e.isBlank { lines.append("") } else { blocks(e.children); flush(); lines.append("") }
            case "h1", "h2", "h3", "h4", "h5", "h6":
                flush()
                let level = min(Int(e.name.dropFirst()) ?? 3, 3)
                let text = Self.split(inline(e.children)).map(Self.finishLine).map { $0.replacingOccurrences(of: "**", with: "") }
                if let first = text.first { lines.append(String(repeating: "#", count: level) + " " + first) }
                lines += text.dropFirst()
            case "ul", "ol":
                flush(); list(e, depth: 0); lines.append("")
            case "li":
                // A list item outside a list: a bullet anyway.
                flush(); item(e, depth: 0, marker: "* ")
            case "blockquote":
                flush()
                var sub = Renderer(media: media)
                sub.blocks(e.children)
                sub.flush()
                absorb(sub)
                let quoted = sub.trimmedLines().map { $0.isEmpty ? ">" : "> " + $0 }
                if !quoted.isEmpty { lines += quoted; lines.append("") }
            case "table":
                flush(); table(e)
            case "hr":
                flush(); lines += ["", "---", ""]
            case "en-media":
                buffer += mediaLine(e)
            case "en-crypt":
                encrypted += 1
                buffer += "\n\(ENMLToMarkdown.mediaMark)\(ENMLToMarkdown.encryptedLine)\n"
            case "en-todo":
                buffer += todo(e.attributes["checked"] == "true")
            case "br":
                buffer += "\n"
            default:
                buffer += inlineElement(e)
            }
        }

        /// Writes what's gathered in the buffer as lines.
        mutating func flush() {
            guard !buffer.isEmpty else { return }
            let text = buffer
            buffer = ""
            lines += Self.split(text).map(Self.finishLine)
        }

        /// Lines of a block's text: blank lines inside are kept, those at either end dropped.
        static func split(_ text: String) -> [String] {
            var pieces = text.split(separator: "\n", omittingEmptySubsequences: false).map { $0.trimmingCharacters(in: .whitespaces) }
            // A checkbox or file part-way along a line starts a new line.
            pieces = pieces.flatMap { piece -> [String] in
                var out: [String] = []
                var current = ""
                for c in piece {
                    if (c == ENMLToMarkdown.todoMark || c == ENMLToMarkdown.mediaMark), !current.trimmingCharacters(in: .whitespaces).isEmpty {
                        out.append(current.trimmingCharacters(in: .whitespaces))
                        current = ""
                    }
                    current.append(c)
                }
                out.append(current.trimmingCharacters(in: .whitespaces))
                return out
            }
            while pieces.first?.isEmpty == true { pieces.removeFirst() }
            while pieces.last?.isEmpty == true { pieces.removeLast() }
            // A checkbox with nothing after it on a line is dropped with the line.
            return pieces.filter { $0 != String(ENMLToMarkdown.todoMark) && $0 != "\(ENMLToMarkdown.todoMark)x" }
        }

        /// Turns the markers into markdown.
        static func finishLine(_ line: String) -> String {
            if line.first == ENMLToMarkdown.mediaMark { return String(line.dropFirst()) }
            if line.first == ENMLToMarkdown.todoMark {
                let checked = line.dropFirst().first == "x"
                return "- [\(checked ? "x" : " ")] " + line.dropFirst(2).trimmingCharacters(in: .whitespaces)
            }
            return line
        }

        mutating func absorb(_ sub: Renderer) {
            encrypted += sub.encrypted
            placed += sub.placed
            missing += sub.missing
        }

        func trimmedLines() -> [String] {
            var l = lines
            while l.first?.isEmpty == true { l.removeFirst() }
            while l.last?.isEmpty == true { l.removeLast() }
            return l
        }

        func finished() -> String {
            var out: [String] = []
            for l in lines where !(l.isEmpty && (out.last?.isEmpty ?? true)) { out.append(l) }
            while out.last?.isEmpty == true { out.removeLast() }
            return out.joined(separator: "\n")
        }

        // MARK: Inline

        /// A checkbox starts its own line wherever it sits (see `split`).
        func todo(_ checked: Bool) -> String {
            "\(ENMLToMarkdown.todoMark)\(checked ? "x" : " ")"
        }

        mutating func mediaLine(_ e: DOM.Element) -> String {
            let hash = (e.attributes["hash"] ?? "").lowercased()
            guard let line = media(hash) else { missing += 1; return "" }
            placed.append(hash)
            return "\n\(ENMLToMarkdown.mediaMark)\(line)\n"
        }

        /// Children rendered inline: text with markdown marks, "\n" between lines.
        mutating func inline(_ children: [DOM.Child]) -> String {
            var s = ""
            for child in children {
                switch child {
                case .text(let t): s += RichTextToMarkdown.escape(Self.collapse(t))
                case .element(let e):
                    switch e.name {
                    case "br": s += "\n"
                    case "en-media": s += mediaLine(e)
                    case "en-todo": s += todo(e.attributes["checked"] == "true")
                    case "en-crypt":
                        encrypted += 1
                        s += "\n\(ENMLToMarkdown.mediaMark)\(ENMLToMarkdown.encryptedLine)\n"
                    case "div", "p", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "table":
                        s += "\n" + inline(e.children) + "\n"
                    case "td", "th": s += inline(e.children) + " "
                    default: s += inlineElement(e)
                    }
                }
            }
            return s
        }

        /// Bold, italic, links and the rest, wrapped around their text.
        mutating func inlineElement(_ e: DOM.Element) -> String {
            if e.name == "img", let src = e.attributes["src"], src.hasPrefix("http") {
                let alt = e.attributes["alt"].map(RichTextToMarkdown.escape) ?? ""
                return "[\(alt.isEmpty ? src : alt)](\(src))"
            }
            var s = inline(e.children)
            if e.name == "code" || e.name == "tt" || e.name == "kbd" || e.name == "samp" {
                return Self.wrap(s.replacingOccurrences(of: "\\", with: ""), "`", "`")
            }
            let style = e.style
            let weight = style["font-weight"] ?? ""
            let bold = ["b", "strong"].contains(e.name) || weight == "bold" || weight == "bolder" || (Int(weight) ?? 0) >= 600
            let italic = ["i", "em", "cite", "var"].contains(e.name) || style["font-style"] == "italic"
            let decoration = style["text-decoration"] ?? style["text-decoration-line"] ?? ""
            let strike = ["s", "strike", "del"].contains(e.name) || decoration.contains("line-through")
            let underline = (e.name == "u" || e.name == "ins" || decoration.contains("underline")) && e.name != "a"
            if bold { s = Self.wrap(s, "**", "**") }
            if italic { s = Self.wrap(s, "*", "*") }
            if strike { s = Self.wrap(s, "~~", "~~") }
            if underline { s = Self.wrap(s, "<u>", "</u>") }
            if e.name == "a", let href = e.attributes["href"]?.trimmingCharacters(in: .whitespaces), !href.isEmpty {
                let label = s.trimmingCharacters(in: .whitespaces)
                if label.isEmpty || label == href || label == RichTextToMarkdown.escape(href) { return href }
                return Self.wrap(s, "[", "](\(href.replacingOccurrences(of: " ", with: "%20").replacingOccurrences(of: ")", with: "%29")))")
            }
            return s
        }

        /// Marks around each line of `s`, outside its surrounding spaces, so markdown reads them.
        static func wrap(_ s: String, _ open: String, _ close: String) -> String {
            s.split(separator: "\n", omittingEmptySubsequences: false).map { piece -> String in
                var p = String(piece)
                var head = ""
                if p.first == ENMLToMarkdown.mediaMark { return p }
                if p.first == ENMLToMarkdown.todoMark { head = String(p.prefix(2)); p = String(p.dropFirst(2)) }
                let core = p.trimmingCharacters(in: .whitespaces)
                guard !core.isEmpty else { return head + p }
                let lead = String(p.prefix { $0 == " " })
                let trail = String(p.reversed().prefix { $0 == " " })
                return head + lead + open + core + close + trail
            }.joined(separator: "\n")
        }

        /// Whitespace as HTML reads it: any run is one space. A no-break space stays a space.
        static func collapse(_ t: String) -> String {
            var out = ""
            var lastSpace = false
            for c in t {
                if c == " " || c == "\n" || c == "\t" || c == "\r" {
                    if !lastSpace { out.append(" ") }
                    lastSpace = true
                } else {
                    out.append(c == "\u{00A0}" ? " " : c)
                    lastSpace = false
                }
            }
            return out
        }

        // MARK: Lists

        mutating func list(_ e: DOM.Element, depth: Int) {
            let ordered = e.name == "ol"
            let todo = e.style["--en-todo"] == "true"
            var n = Int(e.attributes["start"] ?? "") ?? 1
            for child in e.children {
                guard case .element(let c) = child else { continue }
                switch c.name {
                case "li":
                    let marker: String
                    if todo { marker = c.style["--en-checked"] == "true" ? "- [x] " : "- [ ] " }
                    else if ordered { marker = "\(n). "; n += 1 }
                    else { marker = "* " }
                    item(c, depth: depth, marker: marker)
                // Evernote nests a list straight inside the outer one, not inside an item.
                case "ul", "ol": list(c, depth: depth + 1)
                default:
                    var sub = Renderer(media: media)
                    sub.element(c)
                    sub.flush()
                    absorb(sub)
                    let indent = String(repeating: "  ", count: depth + 1)
                    lines += sub.trimmedLines().filter { !$0.isEmpty }.map { indent + $0 }
                }
            }
        }

        mutating func item(_ e: DOM.Element, depth: Int, marker: String) {
            let indent = String(repeating: "  ", count: depth)
            var content: [DOM.Child] = []
            var nested: [DOM.Element] = []
            for child in e.children {
                if case .element(let c) = child, c.name == "ul" || c.name == "ol" { nested.append(c) } else { content.append(child) }
            }
            var sub = Renderer(media: media)
            sub.blocks(content)
            sub.flush()
            absorb(sub)
            var body = sub.trimmedLines().filter { !$0.isEmpty }
            var mark = marker
            // An item that starts with a checkbox is a checklist item.
            if let first = body.first, first.hasPrefix("- [") {
                mark = String(first.prefix(6))
                body[0] = String(first.dropFirst(6))
            }
            if body.isEmpty { body = [""] }
            for (i, line) in body.enumerated() {
                let isEmbed = line.hasPrefix("![") || line.hasPrefix("[") && line.contains("](pane-file:")
                if i == 0, !isEmbed { lines.append(indent + mark + line) }
                else if i == 0 { lines.append(indent + mark.trimmingCharacters(in: .whitespaces)); lines.append(line) }
                // Files can't sit inside a list item; they go on a line of their own.
                else if isEmbed || line == ENMLToMarkdown.encryptedLine { lines.append(line) }
                else { lines.append(indent + "  " + line) }
            }
            for n in nested { list(n, depth: depth + 1) }
        }

        // MARK: Tables

        mutating func table(_ e: DOM.Element) {
            var rows: [[String]] = []
            var after: [String] = []
            func collect(_ el: DOM.Element) {
                for child in el.children {
                    guard case .element(let c) = child else { continue }
                    switch c.name {
                    case "tr":
                        var row: [String] = []
                        for cell in c.children {
                            guard case .element(let td) = cell, td.name == "td" || td.name == "th" else { continue }
                            var sub = Renderer(media: media)
                            sub.blocks(td.children)
                            sub.flush()
                            absorb(sub)
                            var parts: [String] = []
                            for l in sub.trimmedLines() where !l.isEmpty {
                                // Files and encrypted parts can't go in a cell: they follow the table.
                                if l.contains("](pane-file:") || l == ENMLToMarkdown.encryptedLine { after.append(l) } else { parts.append(l) }
                            }
                            row.append(parts.joined(separator: "<br>").replacingOccurrences(of: "|", with: "\\|"))
                            let span = Int(td.attributes["colspan"] ?? "") ?? 1
                            if span > 1 { row += Array(repeating: "", count: min(span, 50) - 1) }
                        }
                        rows.append(row)
                    case "thead", "tbody", "tfoot": collect(c)
                    default: break
                    }
                }
            }
            collect(e)
            rows = rows.filter { !$0.isEmpty }
            guard !rows.isEmpty else { lines += after; return }
            let cols = max(rows.map(\.count).max() ?? 1, 1)
            if lines.last?.isEmpty == false { lines.append("") }
            for (i, row) in rows.enumerated() {
                let padded = row + Array(repeating: "", count: cols - row.count)
                lines.append("| " + padded.map { $0.isEmpty ? " " : $0 }.joined(separator: " | ") + " |")
                if i == 0 { lines.append("|" + Array(repeating: " --- ", count: cols).joined(separator: "|") + "|") }
            }
            lines.append("")
            if !after.isEmpty { lines += after; lines.append("") }
        }

        // MARK: Code

        mutating func code(_ e: DOM.Element) {
            var text = e.name == "pre" ? e.rawText : e.codeLines.joined(separator: "\n")
            text = text.replacingOccurrences(of: "\u{00A0}", with: " ")
            var code = text.components(separatedBy: "\n")
            while code.first?.trimmingCharacters(in: .whitespaces).isEmpty == true { code.removeFirst() }
            while code.last?.trimmingCharacters(in: .whitespaces).isEmpty == true { code.removeLast() }
            guard !code.isEmpty else { return }
            if lines.last?.isEmpty == false { lines.append("") }
            lines.append("```")
            lines += code
            lines += ["```", ""]
        }
    }
}

// MARK: A small DOM

/// Just enough of a DOM for ENML: elements, attributes, text. Built with XMLParser after the
/// DOCTYPE is dropped and HTML's named entities are made numeric (XML knows only five).
enum DOM {
    final class Element {
        let name: String
        let attributes: [String: String]
        var children: [Child] = []
        init(name: String, attributes: [String: String]) {
            self.name = name.lowercased()
            self.attributes = attributes
        }

        /// The inline style, as property → value (lowercased, trimmed).
        var style: [String: String] {
            guard let s = attributes["style"] else { return [:] }
            var out: [String: String] = [:]
            for decl in s.split(separator: ";") {
                let kv = decl.split(separator: ":", maxSplits: 1)
                guard kv.count == 2 else { continue }
                out[kv[0].trimmingCharacters(in: .whitespaces).lowercased()] = kv[1].trimmingCharacters(in: .whitespaces).lowercased()
            }
            return out
        }

        /// Evernote marks a code block with `-en-codeblock:true` (or `--en-codeblock`).
        var isCodeBlock: Bool {
            let s = style
            return s["-en-codeblock"] == "true" || s["--en-codeblock"] == "true"
        }

        /// Nothing but line breaks and spaces: an empty line in Evernote.
        var isBlank: Bool {
            children.allSatisfy {
                switch $0 {
                case .text(let t): t.allSatisfy { $0.isWhitespace }
                case .element(let e): e.name == "br" || (e.name == "span" || e.name == "font") && e.isBlank
                }
            }
        }

        /// Text exactly as written, line breaks included (for `<pre>`).
        var rawText: String {
            children.map {
                switch $0 {
                case .text(let t): t
                case .element(let e): e.name == "br" ? "\n" : (["div", "p", "li"].contains(e.name) ? e.rawText + "\n" : e.rawText)
                }
            }.joined()
        }

        /// A code block's lines: one per inner block, breaks kept.
        var codeLines: [String] {
            var out: [String] = []
            var current = ""
            for child in children {
                switch child {
                case .text(let t): current += t.replacingOccurrences(of: "\n", with: "")
                case .element(let e) where e.name == "br": out.append(current); current = ""
                case .element(let e) where ["div", "p"].contains(e.name):
                    if !current.isEmpty { out.append(current); current = "" }
                    out += e.isBlank ? [""] : e.codeLines
                case .element(let e): current += e.codeLines.joined(separator: "\n")
                }
            }
            if !current.isEmpty { out.append(current) }
            return out
        }
    }

    enum Child {
        case text(String)
        case element(Element)
    }

    static func parse(_ enml: String) -> Element? {
        var s = enml.replacingOccurrences(of: #"<\?xml[^>]*\?>"#, with: "", options: .regularExpression)
        s = s.replacingOccurrences(of: #"<!DOCTYPE[^>\[]*(\[[^\]]*\])?\s*>"#, with: "", options: [.regularExpression, .caseInsensitive])
        s = numericEntities(s)
        guard let data = s.data(using: .utf8) else { return nil }
        let builder = Builder()
        let parser = XMLParser(data: data)
        parser.delegate = builder
        parser.shouldResolveExternalEntities = false
        guard parser.parse(), let root = builder.root else { return nil }
        return root
    }

    private final class Builder: NSObject, XMLParserDelegate {
        var root: Element?
        var stack: [Element] = []
        func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String] = [:]) {
            let e = Element(name: name, attributes: attributes)
            if let top = stack.last { top.children.append(.element(e)) } else { root = e }
            stack.append(e)
        }
        func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
            _ = stack.popLast()
        }
        func parser(_ parser: XMLParser, foundCharacters string: String) {
            guard let top = stack.last else { return }
            if case .text(let t)? = top.children.last { top.children[top.children.count - 1] = .text(t + string) } else { top.children.append(.text(string)) }
        }
        func parser(_ parser: XMLParser, foundCDATA block: Data) {
            self.parser(parser, foundCharacters: String(decoding: block, as: UTF8.self))
        }
    }

    /// `&nbsp;` and the other HTML names XML doesn't know, as numbers. Unknown names are kept as
    /// text, so a stray `&` never breaks the parse.
    static func numericEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        let re = namedOrBare
        let ns = s as NSString
        var out = ""
        var last = 0
        for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            last = NSMaxRange(m.range)
            if m.range(at: 1).location == NSNotFound { out += "&amp;"; continue }
            let name = ns.substring(with: m.range(at: 1))
            if ["amp", "lt", "gt", "quot", "apos"].contains(name) { out += "&\(name);" }
            else if let code = entities[name] { out += "&#\(code);" }
            else { out += "&amp;\(name);" }
        }
        out += ns.substring(from: last)
        return out
    }

    /// Entities decoded to text, for the plain-text fallback.
    static func decodeEntities(_ s: String) -> String {
        guard s.contains("&") else { return s }
        let re = anyEntity
        let ns = s as NSString
        var out = ""
        var last = 0
        for m in re.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: m.range.location - last))
            last = NSMaxRange(m.range)
            let name = ns.substring(with: m.range(at: 1))
            let code: Int? = name.hasPrefix("#x") || name.hasPrefix("#X") ? Int(name.dropFirst(2), radix: 16)
                : name.hasPrefix("#") ? Int(name.dropFirst()) : ["amp": 38, "lt": 60, "gt": 62, "quot": 34, "apos": 39][name] ?? entities[name]
            if let code, let u = Unicode.Scalar(code) { out.append(Character(u)) } else { out += ns.substring(with: m.range) }
        }
        out += ns.substring(from: last)
        return out
    }

    private static let namedOrBare = try! NSRegularExpression(pattern: #"&([A-Za-z][A-Za-z0-9]*);|&(?![A-Za-z][A-Za-z0-9]*;|#[0-9]+;|#[xX][0-9a-fA-F]+;)"#)
    private static let anyEntity = try! NSRegularExpression(pattern: #"&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]*);"#)

    /// The HTML entities that turn up in Evernote notes.
    static let entities: [String: Int] = [
        "nbsp": 160, "iexcl": 161, "cent": 162, "pound": 163, "curren": 164, "yen": 165, "brvbar": 166, "sect": 167,
        "uml": 168, "copy": 169, "ordf": 170, "laquo": 171, "not": 172, "shy": 173, "reg": 174, "macr": 175, "deg": 176,
        "plusmn": 177, "sup2": 178, "sup3": 179, "acute": 180, "micro": 181, "para": 182, "middot": 183, "cedil": 184,
        "sup1": 185, "ordm": 186, "raquo": 187, "frac14": 188, "frac12": 189, "frac34": 190, "iquest": 191,
        "Agrave": 192, "Aacute": 193, "Acirc": 194, "Atilde": 195, "Auml": 196, "Aring": 197, "AElig": 198, "Ccedil": 199,
        "Egrave": 200, "Eacute": 201, "Ecirc": 202, "Euml": 203, "Igrave": 204, "Iacute": 205, "Icirc": 206, "Iuml": 207,
        "ETH": 208, "Ntilde": 209, "Ograve": 210, "Oacute": 211, "Ocirc": 212, "Otilde": 213, "Ouml": 214, "times": 215,
        "Oslash": 216, "Ugrave": 217, "Uacute": 218, "Ucirc": 219, "Uuml": 220, "Yacute": 221, "THORN": 222, "szlig": 223,
        "agrave": 224, "aacute": 225, "acirc": 226, "atilde": 227, "auml": 228, "aring": 229, "aelig": 230, "ccedil": 231,
        "egrave": 232, "eacute": 233, "ecirc": 234, "euml": 235, "igrave": 236, "iacute": 237, "icirc": 238, "iuml": 239,
        "eth": 240, "ntilde": 241, "ograve": 242, "oacute": 243, "ocirc": 244, "otilde": 245, "ouml": 246, "divide": 247,
        "oslash": 248, "ugrave": 249, "uacute": 250, "ucirc": 251, "uuml": 252, "yacute": 253, "thorn": 254, "yuml": 255,
        "OElig": 338, "oelig": 339, "Scaron": 352, "scaron": 353, "Yuml": 376, "fnof": 402, "circ": 710, "tilde": 732,
        "Alpha": 913, "Beta": 914, "Gamma": 915, "Delta": 916, "Omega": 937, "alpha": 945, "beta": 946, "gamma": 947,
        "delta": 948, "epsilon": 949, "lambda": 955, "mu": 956, "pi": 960, "sigma": 963, "omega": 969,
        "ensp": 8194, "emsp": 8195, "thinsp": 8201, "zwnj": 8204, "zwj": 8205, "lrm": 8206, "rlm": 8207,
        "ndash": 8211, "mdash": 8212, "lsquo": 8216, "rsquo": 8217, "sbquo": 8218, "ldquo": 8220, "rdquo": 8221,
        "bdquo": 8222, "dagger": 8224, "Dagger": 8225, "bull": 8226, "hellip": 8230, "permil": 8240, "prime": 8242,
        "Prime": 8243, "lsaquo": 8249, "rsaquo": 8250, "euro": 8364, "trade": 8482, "larr": 8592, "uarr": 8593,
        "rarr": 8594, "darr": 8595, "harr": 8596, "rArr": 8658, "lArr": 8656, "hArr": 8660, "minus": 8722, "infin": 8734,
        "ne": 8800, "le": 8804, "ge": 8805, "asymp": 8776, "check": 10003, "loz": 9674, "spades": 9824, "clubs": 9827,
        "hearts": 9829, "diams": 9830,
    ]
}
