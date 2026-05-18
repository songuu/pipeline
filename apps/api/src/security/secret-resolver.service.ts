import { Injectable } from "@nestjs/common";

@Injectable()
export class SecretResolverService {
  optional(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
  }

  first(names: string[]): string | undefined {
    for (const name of names) {
      const value = this.optional(name);
      if (value) return value;
    }
    return undefined;
  }
}
