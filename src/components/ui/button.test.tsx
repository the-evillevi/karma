// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Button } from "./button";

afterEach(cleanup);

describe("Button", () => {
  it("renders its label and outline variant", () => {
    render(<Button variant="outline">Guardar</Button>);
    expect(
      screen
        .getByRole("button", { name: "Guardar" })
        .getAttribute("data-variant"),
    ).toBe("outline");
  });

  it("renders a link instead of a button with asChild", () => {
    render(
      <Button asChild>
        <a href="#x">Ir</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Ir" }).getAttribute("href")).toBe(
      "#x",
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});
