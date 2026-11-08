import { SignIn } from "@clerk/nextjs";
import { Suspense } from "react";

export const metadata = {
  title: "Sign in",
};

const Page = () => (
  <Suspense>
    <SignIn />
  </Suspense>
);

export default Page;
