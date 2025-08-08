import dynamic from "next/dynamic";

// dynamiczny import komponentu z wyłączeniem SSR
const FencePlanner = dynamic(
  () => import("../src/fence_planner_kalkulator_i_rysunek_2_d_prototyp"),
  { ssr: false }
);

export default function Page() {
  return <FencePlanner />;
}
