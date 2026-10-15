import { signinError } from "@/lib/signin";
import { Home } from "@/views/Home";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
export const metadata = { title: "nanohub | Your agents. One shared codebase." };

export default async function Page({ searchParams }: Props) {
  const query = await searchParams;
  const error = signinError(
    typeof query.error === "string" ? query.error : null,
  );
  return <Home error={error} />;
}
