import { PostPage, postMetadata } from "@/lib/PostPage";
import { MCP_URL } from "@/lib/facts";

export const dynamic = "force-static";
export const metadata = postMetadata("connect-notes-to-gemini");

const FAQ = [
  { q: "Does Gemini support MCP?", a: [
    "Yes, in two places. Gemini CLI, Google's command-line agent, connects to MCP servers you add to its settings, including remote ones that sign in with OAuth. The Gemini app on the web lets you add a custom app by its MCP server address, with limits: Google lists a personal account, the US, age 18 or over, Keep Activity on, and English.",
  ] },
  { q: "Can I use my notes in Gemini on my phone?", a: [
    "Google says a custom app you add on gemini.google.com can then be used in the Gemini app on your phone as well. I haven't been able to test that with Pinto Notes yet.",
  ] },
  { q: "Is it safe to give Gemini my notes?", a: [
    "You approve Gemini in Pinto Notes on your iPhone or Mac and can choose Read Only. Every change it makes keeps the previous version, and you can disconnect it at any time. Google's own page warns that it doesn't control or secure third-party MCP servers, so connect only ones you trust.",
  ] },
];

export default function Page() {
  return (
    <PostPage
      slug="connect-notes-to-gemini"
      intro={<>Gemini can use your notes through MCP, the same standard ChatGPT and Claude use. The reliable way today is Gemini CLI, which takes one command. The Gemini app can add MCP servers too, with more strings attached. Here are both, and what I could and couldn&apos;t check.</>}
      faq={FAQ}
    >
      <h2>Gemini CLI: one command</h2>
      <p>
        Gemini CLI is Google&apos;s open-source agent for the terminal. It connects to MCP servers, including remote ones that sign in with
        OAuth, which is how Pinto Notes works. I&apos;ve checked this path end to end.
      </p>
      <ol>
        <li>Install the Pinto Notes extension: <code>gemini extensions install https://github.com/amber-notes/amber-notes</code></li>
        <li>Start Gemini CLI and run <code>/mcp auth amber-notes</code>. Your browser opens pintonotes.com to sign in.</li>
        <li>The page shows a two-digit number. Pinto Notes on your iPhone or Mac asks whether to allow the app: type the number, choose Read Only or Read and Edit, and choose Allow.</li>
        <li>Back in Gemini CLI, run <code>/mcp</code> to see amber-notes connected with its tools, then ask: &ldquo;Search my Pinto Notes for the standup and summarise this week.&rdquo;</li>
      </ol>
      <p>
        Rather not install an extension? Add the server yourself, for every project: <code>gemini mcp add --scope user --transport http amber-notes {MCP_URL}</code>,
        then sign in with <code>/mcp auth amber-notes</code> the same way. Gemini CLI finds the sign-in details from the server on its own.
        Google documents both commands in <a href="https://geminicli.com/docs/tools/mcp-server/" rel="noopener">MCP servers with Gemini CLI</a>.
      </p>

      <h2>The Gemini app: custom apps (not yet tested)</h2>
      <p>
        The Gemini app on the web can add an MCP server as a custom app. I couldn&apos;t test this with Pinto Notes: it needs an account
        that meets Google&apos;s conditions, and I haven&apos;t had one. So treat these steps as what Google&apos;s documentation says, not
        something I&apos;ve seen work.
      </p>
      <p>Google lists these conditions in <a href="https://support.google.com/gemini/answer/17209137" rel="noopener">Connect &amp; manage custom apps</a>:</p>
      <ul>
        <li>a personal Google Account (not work or school), and age 18 or over, in the US</li>
        <li>Keep Activity turned on, and the app in English</li>
        <li>set up on gemini.google.com on a computer; after that, Google says it works on mobile too</li>
      </ul>
      <p>
        Some third-party guides also say it needs a Google AI Pro or Ultra plan. Google&apos;s page, as I read it, doesn&apos;t say, so check
        what your account offers.
      </p>
      <ol>
        <li>On gemini.google.com, open Settings, then Connected Apps.</li>
        <li>Under Custom apps, choose Add a custom app.</li>
        <li>Enter <code>{MCP_URL}</code>. Pinto Notes supports dynamic client registration, so the Advanced features credentials shouldn&apos;t be needed.</li>
        <li>Choose Next and follow the prompts. When pintonotes.com opens, sign in and approve on your iPhone or Mac as above.</li>
      </ol>
      <p>
        If you try it, I&apos;d like to hear how it goes. Pinto Notes names ChatGPT and Claude on the approval sheet; any other app, Gemini
        included, is shown with a warning that Pinto Notes doesn&apos;t recognize it, so check that you just started connecting it yourself.
      </p>

      <h2>What Gemini can do with your notes</h2>
      <ul>
        <li>Search and read notes, with Read Only.</li>
        <li>With Read and Edit: create notes, append to one, tick checklist items and add table rows. Each change shows up tinted in Pinto Notes with an Undo, and the previous version is kept.</li>
        <li>Locked notes stay out of reach: Gemini sees only their titles.</li>
      </ul>
      <p>
        The <a href="/blog/mcp-server">Pinto Notes MCP server</a> page lists every tool. For the other assistants, see <a href="/blog/connect-chatgpt-to-your-notes">connect ChatGPT or Claude</a>{" "}
        and <a href="/blog/notes-in-claude-code-and-codex">Claude Code and Codex</a>. <a href="/blog/notes-apps-with-mcp">Notes apps with an MCP server</a> compares the options.
      </p>
    </PostPage>
  );
}
