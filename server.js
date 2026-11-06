
import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { verifyKey } from "discord-interactions";

const app = express();

// CORS — PERMITIR CONEXÃO DO APK
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

const ADMIN_DISCORD_ID = "1550285303963717733";
const DISCORD_APPLICATION_ID = "1566997087953092738";

// SUPABASE
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// FUNÇÕES
function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function checkAdmin(password) {
  const saved = process.env.ADMIN_PASSWORD;

  if (!saved || typeof password !== "string") return false;

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

function createKey() {
  return "RAFX-" +
    crypto.randomBytes(12).toString("hex").toUpperCase();
}

async function saveKey(plan) {
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

// DISCORD INTERACTIONS
// Esta rota precisa ficar antes do express.json()
app.post(
  "/discord/interactions",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const signature = req.headers["x-signature-ed25519"];
      const timestamp = req.headers["x-signature-timestamp"];
      const publicKey = process.env.DISCORD_PUBLIC_KEY;

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

      const interaction = JSON.parse(req.body.toString());

      if (interaction.type === 1) {
        return res.json({ type: 1 });
      }

      if (interaction.type !== 2) {
        return res.status(400).send("Interação desconhecida");
      }

      const command = interaction.data?.name;

      if (command === "ping") {
        return res.json({
          type: 4,
          data: {
            content: "🔥 RAFX LICENSE está online!"
          }
        });
      }

      if (command === "gerarkey") {
        if (!isDiscordAdmin(interaction)) {
          return res.json({
            type: 4,
            data: {
              content: "⛔ Você não tem permissão para usar este comando.",
              flags: 64
            }
          });
        }

        const plan = interaction.data.options?.find(
          option => option.name === "plano"
        )?.value;

        const allowedPlans = ["1d", "7d", "30d", "lifetime"];

        if (!allowedPlans.includes(plan)) {
          return res.json({
            type: 4,
            data: {
              content: "Plano inválido.",
              flags: 64
            }
          });
        }

        const key = await saveKey(plan);

        return res.json({
          type: 4,
          data: {
            content:
              "🔥 **RAFX LICENSE — KEY GERADA**\n\n" +
              "🔑 KEY: `" + key + "`\n" +
              "📦 Plano: `" + plan + "`\n" +
              "📌 Status: `unused`",
            flags: 64
          }
        });
      }

      return res.json({
        type: 4,
        data: {
          content: "Comando desconhecido.",
          flags: 64
        }
      });

    } catch (error) {
      console.error("Erro Discord:", error.message);

      return res.json({
        type: 4,
        data: {
          content: "Erro interno ao processar o comando.",
          flags: 64
        }
      });
    }
  }
);

// MIDDLEWARE
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

// REGISTRAR COMANDOS
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

    const commands = [
      {
        name: "ping",
        description: "Verifica se o RAFX LICENSE está online",
        type: 1
      },
      {
        name: "gerarkey",
        description: "Gera uma KEY do RAFX LICENSE",
        type: 1,
        options: [
          {
            name: "plano",
            description: "Escolha a duração da KEY",
            type: 3,
            required: true,
            choices: [
              { name: "1 dia", value: "1d" },
              { name: "7 dias", value: "7d" },
              { name: "30 dias", value: "30d" },
              { name: "Vitalícia", value: "lifetime" }
            ]
          }
        ]
      }
    ];

    const response = await fetch(
      `https://discord.com/api/v10/applications/${DISCORD_APPLICATION_ID}/commands`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(commands)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro Discord:", data);

      return res.status(500).json({
        message: "Não foi possível registrar os comandos."
      });
    }

    return res.json({
      success: true,
      message: "Comandos /ping e /gerarkey registrados!"
    });

  } catch (error) {
    console.error("Erro ao registrar comandos:", error.message);

    return res.status(500).json({
      message: "Erro interno ao registrar comandos."
    });
  }
});

// PÁGINA INICIAL
app.get("/", (req, res) => {
  res.json({
    name: "RAFX LICENSE",
    status: "online"
  });
});

// PAINEL ADMINISTRATIVO
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

            result.innerHTML = "";

            const message = document.createElement("p");
            message.textContent = "KEY GERADA:";

            const key = document.createElement("p");
            key.textContent = data.key;

            const copy = document.createElement("button");
            copy.textContent = "COPIAR KEY";

            copy.onclick = async () => {
              await navigator.clipboard.writeText(data.key);
              copy.textContent = "COPIADA!";
            };

            result.append(message, key, copy);

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

    const allowedPlans = ["1d", "7d", "30d", "lifetime"];

    if (!allowedPlans.includes(plan)) {
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
    console.error("Erro ao gerar key:", error.message);

    return res.status(500).json({
      message: "Não foi possível gerar a key."
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

// VALIDAR LICENÇA
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

    const keyHash = hashKey(key.trim());
    const device = deviceId.trim();

    const { data: license, error } = await supabase
      .from("licenses")
      .select("id, plan, status, device_id, expires_at")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (error) throw error;

    if (!license || license.status === "blocked") {
      return res.status(403).json({
        valid: false,
        message: "Key inválida ou bloqueada."
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

    if (license.status === "active") {
      if (license.device_id !== device) {
        return res.status(403).json({
          valid: false,
          message: "Key vinculada a outro dispositivo."
        });
      }

      return res.json({
        valid: true,
        message: "Key válida!"
      });
    }

    if (license.status !== "unused" || license.device_id) {
      return res.status(403).json({
        valid: false,
        message: "Key indisponível."
      });
    }

    const days = {
      "1d": 1,
      "7d": 7,
      "30d": 30
    };

    if (!days[license.plan] && license.plan !== "lifetime") {
      return res.status(400).json({
        valid: false,
        message: "Plano inválido."
      });
    }

    const now = new Date();

    const expires = days[license.plan]
      ? new Date(now.getTime() + days[license.plan] * 86400000)
      : null;

    const { data: activated, error: updateError } = await supabase
      .from("licenses")
      .update({
        status: "active",
        device_id: device,
        activated_at: now.toISOString(),
        expires_at: expires?.toISOString() ?? null
      })
      .eq("id", license.id)
      .eq("status", "unused")
      .is("device_id", null)
      .select("id")
      .maybeSingle();

    if (updateError) throw updateError;

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
    console.error("Erro de validação:", error.message);

    return res.status(500).json({
      valid: false,
      message: "Erro interno do servidor."
    });
  }
});

// FINAL
export default app;
