import NextAuth, { type NextAuthConfig } from "next-auth";
import Keycloak from "next-auth/providers/keycloak";
import { jwtCallback, sessionCallback } from "@/lib/auth-callbacks";

export const authConfig: NextAuthConfig = {
  providers: [
    Keycloak({
      clientId: process.env.AUTH_KEYCLOAK_ID,
      clientSecret: process.env.AUTH_KEYCLOAK_SECRET,
      issuer: process.env.AUTH_KEYCLOAK_ISSUER,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
