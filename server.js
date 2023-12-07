require("dotenv").config();
const { Urbit } = require("./urbit-api.cjs");

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
    verbose: true,
  });
}

async function sendTestPoke() {
  await connectToUrbit();
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
                      "hi from a bot",
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

sendTestPoke();
