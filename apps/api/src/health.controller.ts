import { Controller, Get } from "@nestjs/common";
import { XEPHA_PROJECT } from "@xepha/core";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      status: "ok",
      service: XEPHA_PROJECT.name,
      version: XEPHA_PROJECT.version,
    };
  }
}
