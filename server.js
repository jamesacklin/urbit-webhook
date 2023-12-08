require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const { Urbit } = require("./urbit-api.cjs");

const app = express();
app.use(bodyParser.json());

async function loadModule() {
  const moduleName = process.env.MODULE_NAME;
  if (!moduleName) {
    console.error("No module name specified in environment variable");
    return null;
  }

  try {
    const module = await import(moduleName);
    return module.default;
  } catch (error) {
    console.error("Module import failed:", error);
    return null;
  }
}

const URBIT_URL = process.env.URBIT_URL;
const URBIT_SHIP = process.env.URBIT_SHIP;
const URBIT_CODE = process.env.URBIT_CODE;
const URBIT_NEST = process.env.URBIT_NEST;

let urbit;
async function connectToUrbit() {
  urbit = await Urbit.authenticate({
    ship: URBIT_SHIP,
    url: URBIT_URL,
    code: URBIT_CODE,
  });
}

async function sendPoke(message) {
  await connectToUrbit();
  if (typeof message !== "string") {
    if (typeof message === "object") message = JSON.stringify(message);
    else message = message.toString();
  }
  try {
    await urbit.poke({
      app: "channels",
      action: "poke",
      mark: "channel-action",
      json: {
        channel: {
          nest: URBIT_NEST,
          action: {
            post: {
              add: {
                "kind-data": {
                  chat: { notice: null },
                },
                author: `~${URBIT_SHIP}`,
                // TODO: make this a real time
                sent: 1701967307494,
                content: [
                  {
                    inline: [
                      message,
                      {
                        break: null,
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    });
    console.log("Poke sent successfully");
  } catch (error) {
    console.error("Error sending poke:", error);
  }
}

app.post("/webhook", async (req, res) => {
  const module = await loadModule();
  let message;
  if (module) {
    message = module(req.body);
  } else {
    message = req.body.toString();
  }
  try {
    await sendPoke(message);
    res.status(200).send("Poke sent successfully");
  } catch (error) {
    res.status(500).send("Error in sending poke");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
