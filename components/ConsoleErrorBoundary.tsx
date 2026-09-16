"use client";
import { Component, Fragment, type ReactNode } from "react";
import { WORKSPACE_LOAD_NOTICE } from "@/lib/client/workspace-state";

export default class ConsoleErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; generation: number }
> {
  state = { failed: false, generation: 0 };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="app-shell">
          <section className="welcome">
            <p className="eyebrow">Hermes</p>
            <h1>今天想做什麼？</h1>
            <p role="alert">{WORKSPACE_LOAD_NOTICE}</p>
            <button
              className="primary"
              type="button"
              onClick={() =>
                this.setState((current) => ({
                  failed: false,
                  generation: current.generation + 1,
                }))
              }
            >
              繼續使用此工作區
            </button>
          </section>
        </main>
      );
    return (
      <Fragment key={this.state.generation}>{this.props.children}</Fragment>
    );
  }
}
