# DRAFT, not published. A formula for a tap of our own (amber-notes/homebrew-tap):
#
#   brew install amber-notes/tap/amber-notes
#
# Named amber-notes because homebrew-core already has "amber" (the Crystal web framework), which
# also installs a binary called amber. The URLs point at GitHub release assets that don't exist
# yet; the checksums are of the v0.2.0 binaries from `deno task compile` (cli/dist/SHA256SUMS).
class AmberNotes < Formula
  desc "Your Amber Notes from the terminal"
  homepage "https://ambernotes.app"
  version "0.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-macos-arm64"
      sha256 "8a80305b41c6b9724e2b305dd7c6699693ca418da29a93188043f16e39b13cd3"
    end
    on_intel do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-macos-x64"
      sha256 "da5bba90fbc82b0b5141335da2f678ad3b7c385a4cafdc31809f6bf8db8ce8d0"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-linux-arm64"
      sha256 "5c051b413b1aa5180c80b56198bbd6c82720e04de541abcf4627a44b083b33b8"
    end
    on_intel do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-linux-x64"
      sha256 "5473fc2fc86a7a4a5eeb76e546e153c3c3132cfd065bdd1ba004a605705a8e30"
    end
  end

  conflicts_with "amber", because: "both install an `amber` binary"

  def install
    bin.install Dir["amber-*"].first => "amber"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/amber --version").strip
    assert_match "amber search", shell_output("#{bin}/amber help")
  end
end
