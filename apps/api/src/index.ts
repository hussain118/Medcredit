import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
  console.log("Hello from Hono");

  return c.text("Hello Hono!");
});

export default {
  port: 8000,
  fetch: app.fetch,
};
