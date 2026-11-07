
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

const plans = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "lifetime": null
};

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function createKey() {
  return "RAFX-" +
    crypto.randomBytes(12).toString("hex").toUpperCase();
}

function checkAdmin(password) {
  const saved = process.env.ADMIN_PASSWORD;

  if (!saved || typeof password !== "string") {
    return false;
  }

  const a = Buffer.from(password);
  const b = Buffer.from(saved);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

function isDiscordAdmin(interaction) {
  const userId =
    interaction.member?.user?.id ||
    interaction.user?.id;

  return userId === ADMIN_DISCORD_ID;
}

async function saveKey(plan) {
  if (!Object.prototype.hasOwnProperty.call(plans, plan)) {
    throw new Error("Plano inválido");
  }

  const key = createKey();

  const { error } = await supabase
    .from("licenses")
    .insert({
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
    .eq("key_hash", hashKey(key.trim()))
    .maybeSingle();

  if (error) throw error;

  return data;
}

function discordReply(res, content) {
  return res.json({
    type: 4,
    data: {
      content,
      flags: 64
    }
  });
}

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With"
  );

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

// DISCORD INTERACTIONS
// Esta rota precisa ficar antes do express.json().
app.post(
  "/discord/interactions",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature =
        req.headers["x-signature-ed25519"];

      const timestamp =
        req.headers["x-signature-timestamp"];

      const publicKey =
        process.env.DISCORD_PUBLIC_KEY;

      if (
        !signature ||
        !timestamp ||
        !publicKey ||
        !Buffer.isBuffer(req.body)
      ) {
        return res.status(401).send("Requisição inválida");
      }

      const valid = verifyKey(
        req.body,
        signature,
        timestamp,
        publicKey
      );

      if (!valid) {
        return res.status(401).send("Assinatura inválida");
      }

      const interaction = JSON.parse(
        req.body.toString()
      );

      // PING DO DISCORD
      if (interaction.type === 1) {
        return res.json({ type: 1 });
      }

      if (interaction.type !== 2) {
        return res.status(400).send("Interação desconhecida");
      }

      const command = interaction.data?.name;
      const options = interaction.data?.options || [];

      const getOption = (name) =>
        options.find(option => option.name === name)?.value;

      if (!isDiscordAdmin(interaction)) {
        return discordReply(
          res,
          "⛔ Você não tem permissão para usar este comando."
        );
      }

      // PING
      if (command === "ping") {
        return discordReply(
          res,
          "🔥 RAFX LICENSE está online!"
        );
      }

      // GERAR KEY
      if (command === "gerarkey") {
        const plan = getOption("plano");

        if (!Object.prototype.hasOwnProperty.call(plans, plan)) {
          return discordReply(res, "❌ Plano inválido.");
        }

        const key = await saveKey(plan);

        return discordReply(
          res,
          "🔥 **RAFX LICENSE — KEY GERADA**\n\n" +
          "🔑 KEY: `" + key + "`\n" +
          "📦 Plano: `" + plan + "`\n" +
          "📌 Status: `unused`"
        );
      }

      // DESATIVAR KEY
      if (command === "desativarkey") {
        const key = getOption("key");

        if (!key) {
          return discordReply(res, "❌ Informe uma key.");
        }

        const license = await getLicense(key);

        if (!license) {
          return discordReply(res, "❌ Key não encontrada.");
        }

        const { error } = await supabase
          .from("licenses")
          .update({ status: "blocked" })
          .eq("id", license.id);

        if (error) throw error;

        return discordReply(
          res,
          "🔒 Key desativada com sucesso!"
        );
      }

      // ATIVAR KEY
      if (command === "ativarkey") {
        const key = getOption("key");

        if (!key) {
          return discordReply(res, "❌ Informe uma key.");
        }

        const license = await getLicense(key);

        if (!license) {
          return discordReply(res, "❌ Key não encontrada.");
        }

        if (license.expires_at &&
            new Date(license.expires_at) <= new Date()) {
          return discordReply(res, "⌛ Essa key expirou.");
        }

        if (license.status !== "blocked") {
          return discordReply(
            res,
            "⚠️ Essa key não está desativada."
          );
        }

        const newStatus = license.device_id
          ? "active"
          : "unused";

        const { error } = await supabase
          .from("licenses")
          .update({ status: newStatus })
          .eq("id", license.id)
          .eq("status", "blocked");

        if (error) throw error;

        return discordReply(
          res,
          "✅ Key reativada!"
        );
      }

      // RESETAR DISPOSITIVO
      if (command === "resetdevice") {
        const key = getOption("key");

        if (!key) {
          return discordReply(res, "❌ Informe uma key.");
        }

        const license = await getLicense(key);

        if (!license) {
          return discordReply(res, "❌ Key não encontrada.");
        }

        if (license.status === "blocked") {
          return discordReply(
            res,
            "🔒 Primeiro reative a key com /ativarkey."
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
          .eq("id", license.id);

        if (error) throw error;

        return discordReply(
          res,
          "✅ Dispositivo resetado! A key poderá ser vinculada novamente."
        );
      }

      // LISTAR KEYS
      if (command === "listarkeys") {
        const { data, error } = await supabase
          .from("licenses")
          .select("id, plan, status, device_id, expires_at")
          .order("id", { ascending: false })
          .limit(20);

        if (error) throw error;

        const list = (data || []).map(license =>
          "ID: " + license.id +
          "\nPlano: " + license.plan +
          "\nStatus: " + license.status +
          "\nDispositivo: " + (license.device_id || "Nenhum") +
          "\nExpira: " + (license.expires_at || "Vitalícia")
        ).join("\n\n");

        return discordReply(
          res,
          list || "Nenhuma key encontrada."
        );
      }

      return discordReply(res, "❌ Comando desconhecido.");

    } catch (error) {
      console.error("Erro Discord:", error);

      return discordReply(
        res,
        "❌ Erro interno ao executar comando."
      );
    }
  }
);

// MIDDLEWARE JSON
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

// PÁGINA INICIAL
app.get("/", (req, res) => {
  res.json({
    name: "RAFX LICENSE",
    status: "online"
  });
});

// REGISTRAR COMANDOS DISCORD
app.post("/admin/register-command", async (req, res) => {
  try {
    const { password } = req.body || {};

    if (!checkAdmin(password)) {
      return res.status(401).json({
        message: "Senha administrativa incorreta."
      });
    }

    if (!process.env.DISCORD_BOT_TOKEN) {
      return res.status(500).json({
        message: "Token do Discord não configurado."
      });
    }

    const keyOption = [{
      name: "key",
      description: "Informe a KEY completa",
      type: 3,
      required: true
    }];

    const commands = [
      {
        name: "ping",
        description: "Verifica se o RAFX está online"
      },
      {
        name: "gerarkey",
        description: "Gera uma KEY RAFX",
        options: [{
          name: "plano",
          description: "Duração da KEY",
          type: 3,
          required: true,
          choices: [
            { name: "1 dia", value: "1d" },
            { name: "7 dias", value: "7d" },
            { name: "30 dias", value: "30d" },
            { name: "Vitalícia", value: "lifetime" }
          ]
        }]
      },
      {
        name: "desativarkey",
        description: "Desativa uma KEY",
        options: keyOption
      },
      {
        name: "ativarkey",
        description: "Reativa uma KEY",
        options: keyOption
      },
      {
        name: "resetdevice",
        description: "Reseta o dispositivo de uma KEY",
        options: keyOption
      },
      {
        name: "listarkeys",
        description: "Lista as últimas 20 KEYs"
      }
    ];

    const response = await fetch(
      `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`,
      {
        method: "PUT",
        headers: {
          Authorization:
            `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(commands)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Discord:", data);

      return res.status(500).json({
        message: "Erro ao registrar comandos no Discord."
      });
    }

    return res.json({
      success: true,
      message: "Comandos RAFX registrados!"
    });

  } catch (error) {
    console.error("Registro:", error);

    return res.status(500).json({
      message: "Erro interno ao registrar comandos."
    });
  }
});

// PAINEL ADMIN
app.get("/admin", (req, res) => {
  res.type("html").send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>RAFX ADMIN</title>
      <style>
        body {
          background: #080a12;
          color: white;
          font-family: Arial;
          text-align: center;
          padding: 30px 15px;
        }

        input, select, button {
          display: block;
          width: 100%;
          max-width: 350px;
          box-sizing: border-box;
          padding: 14px;
          margin: 12px auto;
          border-radius: 8px;
        }

        button {
          background: #7c3aed;
          color: white;
          border: 0;
          font-weight: bold;
        }

        #result {
          word-break: break-all;
        }
      </style>
    </head>
    <body>
      <h1>RAFX LICENSE</h1>
      <h3>PAINEL ADMINISTRATIVO</h3>

      <input id="password" type="password"
        placeholder="Senha administrativa">

      <select id="plan">
        <option value="1d">1 dia</option>
        <option value="7d">7 dias</option>
        <option value="30d">30 dias</option>
        <option value="lifetime">Vitalícia</option>
      </select>

      <button onclick="generate()">GERAR KEY</button>
      <button onclick="registerCommand()">REGISTRAR COMANDOS DISCORD</button>

      <p id="result"></p>

      <script>
        async function generate() {
          const result = document.getElementById("result");
          result.textContent = "Gerando...";

          try {
            const response = await fetch("/admin/generate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                password: document.getElementById("password").value,
                plan: document.getElementById("plan").value
              })
            });

            const data = await response.json();

            if (!response.ok) {
              result.textContent = data.message;
              return;
            }

            result.textContent = "KEY GERADA: " + data.key;

          } catch (error) {
            result.textContent = "Erro de conexão.";
          }
        }

        async function registerCommand() {
          const result = document.getElementById("result");
          result.textContent = "Registrando comandos...";

          try {
            const response = await fetch("/admin/register-command", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                password: document.getElementById("password").value
              })
            });

            const data = await response.json();
            result.textContent = data.message;

          } catch (error) {
            result.textContent = "Erro de conexão.";
          }
        }
      </script>
    </body>
    </html>
  `);
});

// GERAR KEY PELO PAINEL
app.post("/admin/generate", async (req, res) => {
  try {
    const { password, plan } = req.body || {};

    if (!checkAdmin(password)) {
      return res.status(401).json({
        message: "Senha administrativa incorreta."
      });
    }

    if (!Object.prototype.hasOwnProperty.call(plans, plan)) {
      return res.status(400).json({
        message: "Plano inválido."
      });
    }

    const key = await saveKey(plan);

    return res.json({
      success: true,
      key,
      plan
    });

  } catch (error) {
    console.error("Gerar key:", error);

    return res.status(500).json({
      message: "Erro ao gerar key."
    });
  }
});

// PÁGINA DE TESTE
app.get("/test", (req, res) => {
  res.type("html").send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>RAFX TEST</title>
    </head>
    <body style="background:#080a12;color:white;font-family:Arial;text-align:center;padding:30px">
      <h1>RAFX LICENSE</h1>
      <input id="key" placeholder="Digite sua KEY">
      <input id="device" placeholder="ID do dispositivo">
      <button onclick="validateKey()">VALIDAR KEY</button>
      <p id="result"></p>

      <script>
        async function validateKey() {
          const result = document.getElementById("result");
          result.textContent = "Verificando...";

          try {
            const response = await fetch("/validate", {
              method: "POST",
              headers: {
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                key: document.getElementById("key").value,
                deviceId: document.getElementById("device").value
              })
            });

            const data = await response.json();
            result.textContent = data.message;

          } catch (error) {
            result.textContent = "Erro de conexão.";
          }
        }
      </script>
    </body>
    </html>
  `);
});

// VALIDAR KEY
app.post("/validate", async (req, res) => {
  try {
    const { key, deviceId } = req.body || {};

    if (
      typeof key !== "string" ||
      typeof deviceId !== "string" ||
      !key.trim() ||
      !deviceId.trim() ||
      key.length > 200 ||
      deviceId.length > 200
    ) {
      return res.status(400).json({
        valid: false,
        message: "Key ou dispositivo inválido."
      });
    }

    const license = await getLicense(key);

    if (!license || license.status === "blocked") {
      return res.status(403).json({
        valid: false,
        message: "Key inválida ou desativada."
      });
    }

    if (
      license.expires_at &&
      new Date(license.expires_at) <= new Date()
    ) {
      return res.status(403).json({
        valid: false,
        message: "Key expirada."
      });
    }

    const device = deviceId.trim();

    // KEY JÁ ATIVA
    if (license.status === "active") {
      if (license.device_id !== device) {
        return res.status(403).json({
          valid: false,
          message: "Key vinculada a outro dispositivo."
        });
      }

      return res.json({
        valid: true,
        message: "RAFX CHEATS autorizado!"
      });
    }

    // KEY NOVA
    if (license.status !== "unused" || license.device_id) {
      return res.status(403).json({
        valid: false,
        message: "Key indisponível."
      });
    }

    if (!Object.prototype.hasOwnProperty.call(plans, license.plan)) {
      return res.status(400).json({
        valid: false,
        message: "Plano inválido."
      });
    }

    const now = new Date();
    const days = plans[license.plan];

    const expiresAt = days
      ? new Date(now.getTime() + days * 86400000).toISOString()
      : null;

    // Atualização condicional para evitar duas ativações simultâneas
    const { data: activated, error } = await supabase
      .from("licenses")
      .update({
        device_id: device,
        status: "active",
        activated_at: now.toISOString(),
        expires_at: expiresAt
      })
      .eq("id", license.id)
      .eq("status", "unused")
      .is("device_id", null)
      .select("id")
      .maybeSingle();

    if (error) throw error;

    if (!activated) {
      return res.status(403).json({
        valid: false,
        message: "Esta key já foi ativada em outro dispositivo."
      });
    }

    return res.json({
      valid: true,
      message: "Key ativada com sucesso!"
    });

  } catch (error) {
    console.error("Validação:", error);

    return res.status(500).json({
      valid: false,
      message: "Erro interno do servidor."
    });
  }
});

export default app;
