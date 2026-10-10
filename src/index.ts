import { CATALOG } from "./catalog/entries";
import { makeCtx, type AppEnv } from "./env";
import { runCron } from "./jobs/cron";
import { CronScheduler } from "./platform/cloudflare";
import { createApp } from "./web";

const app = createApp(makeCtx);

export default {
  fetch: app.fetch,
  async scheduled(controller, env, ctx) {
    const scheduler = new CronScheduler();
    const appCtx = makeCtx(env);
    scheduler.start(async (task) => {
      const result = await runCron(appCtx, task, CATALOG);
      console.log(JSON.stringify({ cron: controller.cron, task, result }));
    });
    ctx.waitUntil(Promise.resolve().then(() => scheduler.dispatch(controller.cron)));
  },
} satisfies ExportedHandler<AppEnv>;
