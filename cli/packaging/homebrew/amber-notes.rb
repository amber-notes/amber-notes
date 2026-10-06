# DRAFT, not published. A formula for a tap of our own (amber-notes/homebrew-tap):
#
#   brew install amber-notes/tap/amber-notes
#
# Named amber-notes because homebrew-core already has "amber" (the Crystal web framework), which
# also installs a binary called amber. The URLs point at GitHub release assets that don't exist
# yet; the checksums are of the v0.2.0 archives from `deno task compile` (cli/dist/SHA256SUMS).
class AmberNotes < Formula
  desc "Your Amber Notes from the terminal"
  homepage "https://ambernotes.app"
  version "0.2.0"
  license "MIT"

  on_macos do
    on_arm do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-macos-arm64.tar.gz"
      sha256 "622f45ec52c1bd3269c0621cc364a65c8f42899005dbc44a21382c0eda25cb7d"
    end
    on_intel do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-macos-x64.tar.gz"
      sha256 "371d7f4c00041b14a5aa55684f9f1f57b0fcc984fc87e21d0078f5eef2b0f302"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-linux-arm64.tar.gz"
      sha256 "41d2f7087e1dd7112e2be5aa569588a6d474a4b5ec2743c8bf71be7ddb9759cd"
    end
    on_intel do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-linux-x64.tar.gz"
      sha256 "7cc1e611ea697e2156d9ebb82fd5751145c78b3d0854015a27ba8f6d73f26df0"
    end
  end

  conflicts_with "amber", because: "both install an `amber` binary"

  def install
    bin.install "amber"
  end

  test do
    assert_equal version.to_s, shell_output("#{bin}/amber --version").strip
    assert_match "amber search", shell_output("#{bin}/amber help")
  end
end
