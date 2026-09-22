import { createFileRoute } from "@tanstack/react-router";
import { GameShell } from "@/components/game-shell";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <GameShell />;
}
