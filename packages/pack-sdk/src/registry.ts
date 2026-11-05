import { conflict, validationFailed } from "@culture-shock/domain";
import { isCapabilityKey, type CapabilityKey } from "./capabilities.js";

export interface CapabilityHandler<Input = unknown, Output = unknown> {
  readonly key: CapabilityKey;
  readonly version: number;
  execute(input: Input): Promise<Output>;
}

/**
 * Maps capability identifiers to core handlers. Packs are never keys here, so
 * adding a pack can never add a code path; adding a mechanic means registering
 * a reviewed capability.
 */
export class CapabilityRegistry {
  readonly #handlers = new Map<CapabilityKey, CapabilityHandler>();

  register(handler: CapabilityHandler): void {
    if (!isCapabilityKey(handler.key)) {
      throw validationFailed(`Unknown capability "${handler.key}"`);
    }
    if (this.#handlers.has(handler.key)) {
      throw conflict(`Capability "${handler.key}" is already registered`);
    }
    this.#handlers.set(handler.key, handler);
  }

  has(key: string): key is CapabilityKey {
    return isCapabilityKey(key) && this.#handlers.has(key);
  }

  resolve(key: string): CapabilityHandler {
    if (!this.has(key)) {
      throw validationFailed(`Capability "${key}" is not available in this installation`);
    }
    const handler = this.#handlers.get(key);
    if (!handler) throw validationFailed(`Capability "${key}" is not available in this installation`);
    return handler;
  }

  supported(): CapabilityKey[] {
    return [...this.#handlers.keys()].sort();
  }
}
