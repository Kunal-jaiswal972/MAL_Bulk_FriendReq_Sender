import fs from "fs";

try {
  const data = fs.readFileSync("ws_temp.json", "utf8");
  const json = JSON.parse(data);

  if (json.webSocketDebuggerUrl) {
    console.log(json.webSocketDebuggerUrl);
  } else {
    console.error("❌ WebSocket Debugger URL not found.");
    process.exit(1);
  }
} catch (error) {
  console.error("❌ Failed to parse JSON:", error);
  process.exit(1);
}
