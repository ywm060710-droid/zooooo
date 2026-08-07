import { getStore } from "@netlify/blobs";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });

// 兩個代碼：學生用 FAMILY_CODE，預覽用 PREVIEW_CODE（存檔完全分開）
const roleForCode = (code) => {
  if (!code) return null;
  if (process.env.FAMILY_CODE && code === process.env.FAMILY_CODE) return "main";
  if (process.env.PREVIEW_CODE && code === process.env.PREVIEW_CODE) return "preview";
  return null;
};
const roleOf = (req) => roleForCode(req.headers.get("x-family-code") || "");

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname; // /api/...

  // 未設定 FAMILY_CODE 時給予清楚提示
  if (!process.env.FAMILY_CODE) {
    return json({ ok: false, error: "SERVER_NOT_CONFIGURED", message: "請先在 Netlify 設定環境變數 FAMILY_CODE（見部署指南第 4 步）。" }, 500);
  }

  /* ---------- 登入驗證 ---------- */
  if (path === "/api/login" && req.method === "POST") {
    let body = {};
    try { body = await req.json(); } catch (e) {}
    const role = roleForCode(body.code || "");
    if (role) {
      return json({ ok: true, role: role });
    }
    return json({ ok: false, error: "WRONG_CODE" }, 401);
  }

  // 其餘所有請求都必須帶正確的代碼
  const role = roleOf(req);
  if (!role) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const saveKey = role === "preview" ? "preview" : "main";

  const saves = getStore({ name: "saves", consistency: "strong" });
  const images = getStore({ name: "images", consistency: "strong" });

  /* ---------- 進度存檔 ---------- */
  if (path === "/api/save") {
    if (req.method === "GET") {
      const data = await saves.get(saveKey);
      return json({ ok: true, save: data ? JSON.parse(data) : null, role: role });
    }
    if (req.method === "POST") {
      let body;
      try { body = await req.json(); } catch (e) {
        return json({ ok: false, error: "BAD_JSON" }, 400);
      }
      if (!body || typeof body !== "object") return json({ ok: false, error: "BAD_SAVE" }, 400);
      body.savedAt = Date.now();
      await saves.set(saveKey, JSON.stringify(body));
      return json({ ok: true, savedAt: body.savedAt, role: role });
    }
  }

  /* ---------- 記憶圖片 ---------- */
  // POST /api/image  { key, dataUrl }   （dataUrl 為壓縮後的 jpeg base64）
  if (path === "/api/image" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch (e) {
      return json({ ok: false, error: "BAD_JSON" }, 400);
    }
    const key = (body.key || "").replace(/[^a-zA-Z0-9_\-\u4e00-\u9fff]/g, "");
    const dataUrl = body.dataUrl || "";
    if (!key || !dataUrl.startsWith("data:image/")) return json({ ok: false, error: "BAD_IMAGE" }, 400);
    if (dataUrl.length > 1500000) return json({ ok: false, error: "TOO_LARGE", message: "圖片太大，請重試。" }, 413);
    await images.set(saveKey + "__" + key, dataUrl);
    return json({ ok: true, key });
  }

  // GET /api/image?key=xxx
  if (path === "/api/image" && req.method === "GET") {
    const key = url.searchParams.get("key") || "";
    const dataUrl = await images.get(saveKey + "__" + key);
    if (!dataUrl) return json({ ok: false, error: "NOT_FOUND" }, 404);
    return json({ ok: true, key, dataUrl });
  }

  // DELETE /api/image?key=xxx
  if (path === "/api/image" && req.method === "DELETE") {
    const key = url.searchParams.get("key") || "";
    await images.delete(saveKey + "__" + key);
    return json({ ok: true });
  }

  /* ---------- 系統自我檢查 ---------- */
  if (path === "/api/ping") {
    const t = Date.now();
    await saves.set("_ping", String(t));
    const back = await saves.get("_ping");
    return json({ ok: back === String(t), blobs: back === String(t) });
  }

  return json({ ok: false, error: "NOT_FOUND" }, 404);
};

export const config = {
  path: ["/api/login", "/api/save", "/api/image", "/api/ping"]
};
