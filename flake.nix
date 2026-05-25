{
  description = "AUTOZUK — Inferno Wave Solver";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            nodejs_22
            typescript
            typescript-language-server
            biome
          ];

          shellHook = ''
            echo "AUTOZUK dev shell"
            echo "  node    $(node --version)"
            echo "  npm     $(npm --version)"
            echo "  biome   $(biome --version | head -1)"
            echo ""
            echo "  npm install     install dependencies"
            echo "  npm run dev     start vite dev server"
            echo "  npm run build   typecheck + build to ./docs"
            echo "  npm run preview preview production build"
            echo "  npm run typecheck"
            echo "  npm run format  biome format --write"
            echo "  npm run lint    biome lint"
            echo "  npm run check   biome check --write (format + lint + fix)"
          '';
        };
      });
}
