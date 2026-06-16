import { spawn } from "node:child_process";

export interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
}

export function runCommand(command: string, args: string[]): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        command: [command, ...args].join(" "),
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };

      if (code === 0) {
        resolve(result);
      } else {
        const error = new Error(`Command failed (${code}): ${result.command}\n${result.stderr || result.stdout}`);
        Object.assign(error, { result });
        reject(error);
      }
    });
  });
}
