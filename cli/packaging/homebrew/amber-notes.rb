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
      sha256 "22bdbc62f7a10416961dc12fa67f342b5feac6ece6702fbd774ab41de57b46eb"
    end
    on_intel do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-macos-x64.tar.gz"
      sha256 "4250146ef9b30a9b5f82e04a35fbf8e40f181a8d24896cbe38195e83b908c727"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-linux-arm64.tar.gz"
      sha256 "ff48add32734c1e1363e191564d3504a5ad0d27fc19913403a056b5460e921c8"
    end
    on_intel do
      url "https://github.com/amber-notes/amber-notes/releases/download/cli-v0.2.0/amber-linux-x64.tar.gz"
      sha256 "99783fe8deec18586b9e63880bf67c7683eed2dde66fb9d09a00c1282483bc1a"
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
