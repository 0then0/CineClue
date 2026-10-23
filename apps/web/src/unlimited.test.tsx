import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { GameView } from "../../../packages/game-engine/src/model.ts";
import App from "./App.tsx";

const key = "cineclue:unlimited:v1";
const game: GameView = {
  date: null,
  id: "first",
  mode: "unlimited",
  status: "playing",
  guesses: [],
  maxAttempts: 8,
  difficulty: "normal",
  hints: { unlocked: 0, remaining: 0, nextUnlock: 3, options: [], used: [] },
};
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem("cineclue:locale", '"en"');
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function mockApi(saved: Record<string, GameView> = { first: game }) {
  let count = 0;
  const fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    let body: unknown;
    let status = 200;
    if (url === "/api/packs")
      body = {
        packs: [
          { id: "popular", name: { en: "All movies" }, count: 100 },
          { id: "animation", name: { en: "Animation" }, count: 20 },
        ],
        catalogSize: 100,
      };
    else if (url === "/api/daily") body = { ...game, id: "daily", mode: "daily" };
    else if (url === "/api/unlimited" && init?.method === "POST") {
      count++;
      const options = JSON.parse(String(init.body));
      const next = { ...game, id: `new-${count}`, difficulty: options.difficulty };
      saved[next.id] = next;
      body = next;
    } else if (url.startsWith("/api/unlimited/")) {
      body = saved[decodeURIComponent(url.split("/").at(-1) ?? "")];
      if (!body) {
        body = { error: "not_found" };
        status = 404;
      }
    } else throw new Error(`Unexpected request: ${url}`);
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal("fetch", fetch);
  return {
    fetch,
    created: () =>
      fetch.mock.calls.filter(([url, init]) => url === "/api/unlimited" && init.method === "POST"),
  };
}
async function ready() {
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Unlimited" }).hasAttribute("disabled")).toBe(false),
  );
}
it("uses a clean URL, resumes on navigation and reload, and starts another game only explicitly", async () => {
  const api = mockApi();
  const { unmount } = render(<App />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Unlimited" }));
  await screen.findByRole("combobox", { name: "Difficulty" });
  await ready();
  expect(window.location.pathname).toBe("/unlimited");
  expect(api.created()).toHaveLength(1);
  const first = JSON.parse(sessionStorage.getItem(key) ?? "null");
  fireEvent.click(screen.getByRole("button", { name: "Daily" }));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Unlimited" }));
  await screen.findByRole("combobox", { name: "Difficulty" });
  await ready();
  expect(api.created()).toHaveLength(1);
  unmount();
  render(<App />);
  await ready();
  expect(api.created()).toHaveLength(1);
  expect(JSON.parse(sessionStorage.getItem(key) ?? "null")).toEqual(first);
  fireEvent.change(screen.getByRole("combobox", { name: "Difficulty" }), {
    target: { value: "hard" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "Film collection" }), {
    target: { value: "animation" },
  });
  fireEvent.click(screen.getByRole("button", { name: /New game/ }));
  await waitFor(() => expect(api.created()).toHaveLength(2));
  await ready();
  expect(JSON.parse(api.created()[1][1].body)).toEqual({ difficulty: "hard", pack: "animation" });
  expect(JSON.parse(sessionStorage.getItem(key) ?? "null").id).not.toBe(first.id);
  expect(window.location.pathname).toBe("/unlimited");
});
it("creates only one game on direct entry under StrictMode", async () => {
  window.history.replaceState({}, "", "/unlimited");
  const api = mockApi();
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await ready();
  expect(api.created()).toHaveLength(1);
  expect(window.location.pathname).toBe("/unlimited");
});
it("adopts a legacy link without creating a new game and restores its difficulty", async () => {
  window.history.replaceState({}, "", "/unlimited/first");
  const api = mockApi({ first: { ...game, difficulty: "hard" } });
  render(<App />);
  await waitFor(() => expect(window.location.pathname).toBe("/unlimited"));
  await ready();
  expect(api.created()).toHaveLength(0);
  expect((screen.getByRole("combobox", { name: "Difficulty" }) as HTMLSelectElement).value).toBe(
    "hard",
  );
  expect(JSON.parse(sessionStorage.getItem(key) ?? "null").id).toBe("first");
});
it("replaces a deleted stored session, but preserves errors for unavailable legacy links", async () => {
  sessionStorage.setItem(key, JSON.stringify({ id: "deleted", pack: "popular" }));
  window.history.replaceState({}, "", "/unlimited");
  const api = mockApi();
  const { unmount } = render(<App />);
  await ready();
  expect(api.created()).toHaveLength(1);
  unmount();
  window.history.replaceState({}, "", "/unlimited/missing");
  render(<App />);
  await screen.findByRole("alert");
  expect(api.created()).toHaveLength(1);
  expect(window.location.pathname).toBe("/unlimited/missing");
});
it("keeps the active game after a temporary network failure", async () => {
  sessionStorage.setItem(key, JSON.stringify({ id: "first", pack: "animation" }));
  window.history.replaceState({}, "", "/unlimited");
  const api = mockApi();
  const implementation = api.fetch.getMockImplementation();
  if (!implementation) throw new Error("Missing API mock");
  api.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/unlimited/first") throw new Error("offline");
    return implementation(url, init);
  });
  render(<App />);
  await screen.findByRole("alert");
  expect(api.created()).toHaveLength(0);
  expect(JSON.parse(sessionStorage.getItem(key) ?? "null").id).toBe("first");
  api.fetch.mockImplementation(implementation);
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await ready();
  expect(api.created()).toHaveLength(0);
  expect(
    (screen.getByRole("combobox", { name: "Film collection" }) as HTMLSelectElement).value,
  ).toBe("animation");
});
it("resumes in memory when sessionStorage is blocked", async () => {
  const read = Storage.prototype.getItem;
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
    if (this === sessionStorage) throw new Error("blocked");
    return read.call(this, key);
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (this === sessionStorage) throw new Error("blocked");
    return write.call(this, key, value);
  });
  const api = mockApi();
  render(<App />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Unlimited" }));
  await screen.findByRole("combobox", { name: "Difficulty" });
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Daily" }));
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Unlimited" }));
  await screen.findByRole("combobox", { name: "Difficulty" });
  await ready();
  expect(api.created()).toHaveLength(1);
});
it("does not create a second replacement when an earlier missing-session response arrives late", async () => {
  sessionStorage.setItem(key, JSON.stringify({ id: "deleted", pack: "popular" }));
  window.history.replaceState({}, "", "/unlimited");
  const api = mockApi();
  const implementation = api.fetch.getMockImplementation();
  if (!implementation) throw new Error("Missing API mock");
  let release: (() => void) | undefined;
  let reads = 0;
  api.fetch.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/unlimited/deleted" && ++reads === 2) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    return implementation(url, init);
  });
  render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  await waitFor(() => expect(sessionStorage.getItem(key)).toContain("new-1"));
  if (!release) throw new Error("Missing delayed response");
  release();
  await ready();
  expect(api.created()).toHaveLength(1);
});
it.each(["invalid JSON", '{"id":42,"pack":"popular"}'])(
  "recovers from invalid stored state: %s",
  async (value) => {
    sessionStorage.setItem(key, value);
    window.history.replaceState({}, "", "/unlimited");
    const api = mockApi();
    render(<App />);
    await ready();
    expect(api.created()).toHaveLength(1);
  },
);
it("changes the address when entering the challenge builder and preserves the Unlimited session", async () => {
  sessionStorage.setItem(key, JSON.stringify({ id: "first", pack: "popular" }));
  window.history.replaceState({}, "", "/unlimited");
  const api = mockApi();
  render(<App />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Challenge" }));
  expect(window.location.pathname).toBe("/challenge");
  expect(screen.queryByRole("combobox", { name: "Difficulty" })).toBeNull();
  expect(screen.getByRole("button", { name: "Challenge" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.getByRole("combobox", { name: "Which film are you thinking of?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Unlimited" }));
  await screen.findByRole("combobox", { name: "Difficulty" });
  await ready();
  expect(window.location.pathname).toBe("/unlimited");
  expect(api.created()).toHaveLength(0);
  expect(JSON.parse(sessionStorage.getItem(key) ?? "null").id).toBe("first");
});
it("opens the builder directly and after reload without loading or creating a game", async () => {
  window.history.replaceState({}, "", "/challenge");
  const api = mockApi();
  const { unmount } = render(<App />);
  await ready();
  expect(screen.getByRole("combobox", { name: "Which film are you thinking of?" })).toBeTruthy();
  unmount();
  render(<App />);
  await ready();
  expect(screen.getByRole("button", { name: "Challenge" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(api.fetch.mock.calls.every(([url]) => url === "/api/packs")).toBe(true);
});
it("restores the challenge builder through browser Back navigation", async () => {
  const api = mockApi();
  render(<App />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Challenge" }));
  expect(window.location.pathname).toBe("/challenge");
  fireEvent.click(screen.getByRole("button", { name: "Daily" }));
  await ready();
  window.history.back();
  await waitFor(() => expect(window.location.pathname).toBe("/challenge"));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Challenge" }).getAttribute("aria-current")).toBe(
      "page",
    ),
  );
  window.history.forward();
  await waitFor(() => expect(window.location.pathname).toBe("/"));
  await ready();
  expect(screen.getByRole("button", { name: "Daily" }).getAttribute("aria-current")).toBe("page");
  expect(api.created()).toHaveLength(0);
});
