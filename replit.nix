{ pkgs }: {
  deps = [
    pkgs.nodejs-20_x
    pkgs.python3
    pkgs.pkg-config
    pkgs.libuuid
    pkgs.sqlite
    pkgs.gnumake
  ];
}
