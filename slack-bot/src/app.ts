import "dotenv/config";
import { App } from "@slack/bolt";

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,     
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN        
});

app.event("app_mention", async ({ event, say }) => {
  await say(`Hey <@${event.user}>! I'm alive ✅  Try /hello.`);
});

app.command("/hello", async ({ ack, respond, command }) => {
  await ack();
  await respond(`Hello, <@${command.user_id}>! 👋`);
});

app.command("/gamble", async ({ ack, respond, command }) => {
  await ack();
  await respond('Among us')
})

const port = Number(process.env.PORT) || 3000;
(async () => {
  await app.start({ port });
  console.log(`GAMBELING TIME ON ${port} (On socket time)`);
})();