import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export const metadata = {
  title: "Sign up",
};

const Page = () => (
  <Suspense>
    <SignUp />
  </Suspense>
);

export default Page;
