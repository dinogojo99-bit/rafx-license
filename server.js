
import express from "express";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function hashKey(key) {
  return crypto
    .createHash("sha256")
    .update(key)
    .digest("hex");
}

app.post("/validate", async (req, res) => {
  try {
    const { key, deviceId } = req.body;

    if (!key || !deviceId) {
      return res.status(400).json({
        valid: false,
        message: "Informe a key e o dispositivo."
      });
    }

    const keyHash = hashKey(key.trim());

    const { data: license, error } = await supabase
      .from("licenses")
      .select("*")
      .eq("key_hash", keyHash)
      .maybeSingle();

    if (error) throw error;

    if (!license || license.status === "blocked") {
      return res.status(403).json({
        valid: false,
        message: "Key inválida ou bloqueada."
      });
    }

    if (license.device_id && license.device_id !== deviceId) {
      return res.status(403).json({
        valid: false,
        message: "Key já vinculada a outro dispositivo."
      });
    }

    const now = new Date();

    if (license.expires_at &&
        new Date(license.expires_at) <= now) {
      return res.status(403).json({
        valid: false,
        message: "Key expirada."
      });
    }

    if (license.status === "unused") {
      const days = {
        "1d": 1,
        "7d": 7,
        "30d": 30
      };

      const expires = days[license.plan]
        ? new Date(now.getTime() + days[license.plan] * 86400000)
        : null;

      const { error: updateError } = await supabase
        .from("licenses")
        .update({
          status: "active",
          device_id: deviceId,
          activated_at: now.toISOString(),
          expires_at: expires?.toISOString() ?? null
        })
        .eq("id", license.id)
        .eq("status", "unused");

      if (updateError) throw updateError;

      return res.json({
        valid: true,
        message: "Key ativada com sucesso!"
      });
    }

    return res.json({
      valid: true,
      message: "Key válida!"
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      valid: false,
      message: "Erro interno do servidor."
    });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("RAFX LICENSE online!");
});
