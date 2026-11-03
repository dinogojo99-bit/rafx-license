
import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const app = express();
app.use(express.json({ limit: "10kb" }));

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Teste de funcionamento
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});
app.get("/", (req, res) => {
  res.json({
    name: "RAFX LICENSE",
    status: "online"
  });
});
app.get("/test", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>RAFX LICENSE TEST</title>
      <style>
        body {
          background: #080a12;
          color: white;
          font-family: Arial;
          text-align: center;
          padding: 30px 15px;
        }
        input, button {
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
        #result { margin-top: 20px; }
      </style>
    </head>
    <body>
      <h1>RAFX LICENSE</h1>
      <p>TESTE DE ATIVAÇÃO</p>

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
            result.textContent = "Erro de conexão com o servidor.";
          }
        }
      </script>
    </body>
    </html>
  `);
});

function hashKey(key) {
  return crypto.createHash("sha256").update(key).digest("hex");
}

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

    if (!process.env.SUPABASE_URL ||
        !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({
        valid: false,
        message: "Servidor não configurado."
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

    if (license.expires_at &&
        new Date(license.expires_at) <= new Date()) {
      return res.status(403).json({
        valid: false,
        message: "Key expirada."
      });
    }

    // Key já ativada: somente o mesmo dispositivo pode usar.
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

    const now = new Date();
    const expires = days[license.plan]
      ? new Date(now.getTime() + days[license.plan] * 86400000)
      : null;

    if (!days[license.plan] && license.plan !== "lifetime") {
      return res.status(400).json({
        valid: false,
        message: "Plano inválido."
      });
    }

    // Atualização condicional: somente uma ativação vence a disputa.
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
