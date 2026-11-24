declare module "africastalking-client" {
  export interface AfricastalkingClient {
    on(event: string, handler: (payload?: unknown) => void, once?: boolean): void;
    call(phoneNumber: string): void;
    answer(): void;
    hangup(): void;
    dtmf(digit: string): void;
    mute(): void;
    unmute(): void;
    hold(): void;
    unhold(): void;
    destroy(): void;
  }

  const Africastalking: {
    Client: new (token: string) => AfricastalkingClient;
  };

  export default Africastalking;
}
