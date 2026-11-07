import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { verifyKey } from "discord-interactions";

const app = express();

const ADMIN_DISCORD_ID = "1550285303963717733";
const DISCORD_APPLICATION_ID = "1566997087953092738";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const hashKey = (key) =>
  crypto.createHash("sha256").update(key).digest("hex");

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

const plans = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  lifetime: null
};

async function saveKey(plan) {
  const key = crypto.randomBytes(12).toString("hex").toUpperCase();

  const { error } = await supabase.from("licenses").insert({
    key_hash: hashKey(key),
    plan,
    status: "unused"
  });

  if (error) throw error;

  return key;
}

async function getLicense(key) {
  const { data, error } = await supabase
    .from("licenses")
    .select("*")
    .eq("key_hash", hashKey(key))
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function discordReply(res, content, ephemeral = true) {
  return res.json({
    type: 4,
    data: {
      content,
      flags: ephemeral ? 64 : 0
    }
  });
}

// Discord interactions: precisa receber o corpo RAW
app.post(
  "/discord/interactions",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["x-signature-ed25519"];
    const timestamp = req.headers["x-signature-timestamp"];

    try {
      const valid = verifyKey(
        req.body,
        signature,
        timestamp,
        process.env.DISCORD_PUBLIC_KEY
      );

      if (!valid) return res.status(401).send("Invalid signature");

      const interaction = JSON.parse(req.body.toString());

      if (interaction.type === 1) {
        return res.json({ type: 1 });
      }

      const command = interaction.data.name;
      const options = interaction.data.options || [];
      const getOption = (name) =>
        options.find((option) => option.name === name)?.value;

      const userId = interaction.member?.user?.id ||
        interaction.user?.id;

      if (userId !== ADMIN_DISCORD_ID) {
        return discordReply(res, "❌ Você não tem permissão.");
      }

      if (command === "ping") {
        return discordReply(res, "🏓 RAFX License online!");
      }

      if (command === "gerarkey") {
        const plan = getOption("plano");

        if (!plans.hasOwnProperty(plan)) {
          return discordReply(res, "❌ Plano inválido.");
        }

        const key = await saveKey(plan);

        return discordReply(
          res,
          `✅ **KEY GERADA**\n\n\`${key}\`\nPlano: ${plan}`
        );
      }

      if (command === "desativarkey") {
        const key = getOption("key");
        const { error } = await supabase
          .from("licenses")
          .update({ status: "blocked" })
          .eq("key_hash", hashKey(key));

        if (error) throw error;

        return discordReply(res, "🔒 Key desativada.");
      }

      if (command === "ativarkey") {
        const key = getOption("key");
        const license = await getLicense(key);

        if (!license) {
          return discordReply(res, "❌ Key não encontrada.");
        }

        if (license.expires_at &&
            new Date(license.expires_at) < new Date()) {
          return discordReply(res, "⌛ Essa key expirou.");
        }

        if (license.status !== "blocked") {
          return discordReply(res, "⚠️ Essa key já está ativa.");
        }

        const status = license.device_id ? "active" : "unused";

        const { error } = await supabase
          .from("licenses")
          .update({ status })
          .eq("key_hash", hashKey(key));

        if (error) throw error;

        return discordReply(res, "✅ Key reativada.");
      }

      if (command === "resetdevice") {
        const key = getOption("key");
        const license = await getLicense(key);

        if (!license) {
          return discordReply(res, "❌ Key não encontrada.");
        }

        if (license.status === "blocked") {
          return discordReply(
            res,
            "🔒 Ative a key antes de resetar o dispositivo."
          );
        }

        const { error } = await supabase
          .from("licenses")
          .update({
            status: "unused",
            device_id: null,
            activated_at: null,
            expires_at: null
          })
          .eq("key_hash", hashKey(key));

        if (error) throw error;

        return discordReply(
          res,
          "✅ Dispositivo resetado. A key poderá ser vinculada novamente."
        );
      }

      if (command === "listarkeys") {
        const { data, error } = await supabase
          .from("licenses")
          .select("id, plan, status, device_id, expires_at")
          .order("id", { ascending: false })
          .limit(20);

        if (error) throw error;

        const list = (data || []).map((license) =>
          `ID: ${license.id}\nPlano: ${license.plan}\nStatus: ${license.status}\nDispositivo: ${license.device_id || "Nenhum"}\nExpira: ${license.expires_at || "Vitalícia"}`
        ).join("\n\n");

        return discordReply(
          res,
          list || "Nenhuma key encontrada."
        );
      }

      return discordReply(res, "❌ Comando desconhecido.");

    } catch (error) {
      console.error(error);
      return discordReply(res, "❌ Erro interno ao executar comando.");
    }
  }
);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "RAFX LICENSE online" });
});

app.post("/validate", async (req, res) => {
  try {
    const { key, deviceId } = req.body;

    if (!key || !deviceId) {
      return res.status(400).json({
        valid: false,
        message: "Key ou dispositivo ausente."
      });
    }

    const license = await getLicense(key);

    if (!license) {
      return res.json({
        valid: false,
        message: "Key inválida."
      });
    }

    if (license.status === "blocked") {
      return res.json({
        valid: false,
        message: "Key desativada."
      });
    }

    if (
      license.expires_at &&
      new Date(license.expires_at) < new Date()
    ) {
      return res.json({
        valid: false,
        message: "Key expirada."
      });
    }

    if (license.device_id && license.device_id !== deviceId) {
      return res.json({
        valid: false,
        message: "Key vinculada a outro dispositivo."
      });
    }

    if (!license.device_id) {
      const days = plans[license.plan];

      const expiresAt = days
        ? new Date(Date.now() + days * 86400000).toISOString()
        : null;

      const { error } = await supabase
        .from("licenses")
        .update({
          device_id: deviceId,
          status: "active",
          activated_at: new Date().toISOString(),
          expires_at: expiresAt
        })
        .eq("key_hash", hashKey(key));

      if (error) throw error;
    }

    return res.json({
      valid: true,
      message: "RAFX CHEATS autorizado!"
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      valid: false,
      message: "Erro no servidor."
    });
  }
});

export default app;
