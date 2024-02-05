import { readFileSync } from "fs";
import { resolve } from "path";

class ConfigClass {
  public readonly author: string;
  public readonly project: string;

  constructor(configFile: any) {

    if (!configFile.author) {
      throw new Error("Error: author must be specified.");
    }
    this.author = configFile.author;
    
    if (!configFile.project) {
      throw new Error("Error: project must be specified.");
    }
    this.project = configFile.project;
  }
}

export const Config = new ConfigClass(
  JSON.parse(readFileSync(resolve(__dirname, "config.json"), "utf8"))
);
