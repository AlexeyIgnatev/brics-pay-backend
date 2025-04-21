export interface registrationMessage {
  email: string;
}
export interface resetPasswordMessage extends registrationMessage {
  link: string;
}
