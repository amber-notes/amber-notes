import { createRoot } from "react-dom/client"
import { route } from "amber-router"
import "./index.css"
import App from "./App"
import { active } from "@/lib/lift"

createRoot(document.getElementById("root")!).render(<App />)
// Open on the workout if one is running.
if (active()) route("/live")
