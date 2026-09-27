import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lead Generation OS" },
      { name: "description", content: "Import, qualify, and email business leads from one internal tool." },
      { property: "og:title", content: "Lead Generation OS" },
      { property: "og:description", content: "Import, qualify, and email business leads from one internal tool." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: () => {
    throw redirect({ to: "/leads" });
  },
});
