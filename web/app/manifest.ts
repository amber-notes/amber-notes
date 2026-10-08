import type { MetadataRoute } from "next";

// For "Add to Home Screen" and browsers that show a site's icon and colour.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Pinto Notes",
    short_name: "Pinto Notes",
    description: "The notes app your AI can actually use.",
    start_url: "/",
    display: "browser",
    background_color: "#fff4e6",
    theme_color: "#f0901a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
