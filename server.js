
import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { verifyKey } from "discord-interactions";

const app = express();

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Funções auxiliares
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

// Discord: receber interações
// Esta rota precisa ficar antes do express.json()
app.post(
  "/discord/interactions",
  express.raw({ type: "application/json" }),
  (req, res) => {
    try {
      const signature = req.headers["x-signature-ed25519"];
      const timestamp = req.headers["x-signature-timestamp"];
      const publicKey = process.env.DISCORD_PUBLIC_KEY;

      if (!signature || !timestamp || !publicKey ||
          !Buffer.isBuffer(req.body)) {
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

      // Verificação do endpoint
      if (interaction.type === 1) {
        return res.json({ type: 1 });
      }

      // Comando /ping
      if (
        interaction.type === 2 &&
        interaction.data?.name === "ping"
      ) {
        return res.json({
          type: 4,
          data: {
            content: "🔥 RAFX LICENSE está online!"
          }
        });
      }

      return res.status(400).send("Comando desconhecido");

    } catch (error) {
      console.error("Erro Discord:", error.message);
      return res.status(400).send("Erro na interação");
    }
  }
);

// JSON das outras rotas
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false }));

// Registrar comando /ping
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

    const response = await fetch(
      "https://discord.com/api/v10/applications/1566997087953092738/commands",
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify([
          {
            name: "ping",
            description: "Verifica se o RAFX LICENSE está online",
            type: 1
          }
        ])
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro Discord:", data);
      return res.status(500).json({
        message: "Não foi possível registrar o comando."
      });
    }

    return res.json({
      success: true,
      message: "Comando /ping registrado com sucesso!"
    });

  } catch (error) {
    console.error("Erro ao registrar comando:", error.message);
    return res.status(500).json({
      message: "Erro interno ao registrar comando."
    });
  }
});

// Página inicial
app.get("/", (req, res) => {
  res.json({
    name: "RAFX LICENSE",
    status: "online"
  });
});

// Painel administrativo
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
      <button onclick="registerCommand()">REGISTRAR /PING</button>

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
          result.textContent = "Registrando comando...";

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

// Gerar e salvar key
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

    const key = "RAFX-" +
      crypto.randomBytes(12).toString("hex").toUpperCase();

    const { error } = await supabase
      .from("licenses")
      .insert({
        key_hash: hashKey(key),
        plan,
        status: "unused"
      });

    if (error) throw error;

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

// Página de teste de licença
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

// Validar licença
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

export default app;
