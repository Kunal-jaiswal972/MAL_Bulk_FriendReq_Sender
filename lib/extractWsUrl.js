import fs from "fs";

try {
  const data = fs.readFileSync("ws_temp.json", "utf8").trim();
  if (!data) throw new Error("Empty JSON file.");

  const json = JSON.parse(data);
  if (json.webSocketDebuggerUrl) {
    console.log(json.webSocketDebuggerUrl);
  } else {
    throw new Error("WebSocket Debugger URL not found.");
  }
} catch (error) {
  console.error("❌ Failed to parse JSON:", error.message);
  process.exit(1);
}
