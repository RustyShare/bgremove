# NixOS module exposing bgremove as a systemd service.
#
# Enable with, e.g.:
#   services.bgremove = {
#     enable = true;
#     host = "0.0.0.0";   # listen on all interfaces (default 127.0.0.1)
#     port = 8000;
#     openFirewall = true;
#   };
#
# `self` is this flake, used to default the package to the flake's build.
{ self }:
{ config, lib, pkgs, ... }:

let
  cfg = config.services.bgremove;
in
{
  options.services.bgremove = {
    enable = lib.mkEnableOption "the bgremove background-removal web service";

    package = lib.mkOption {
      type = lib.types.package;
      default = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
      defaultText = lib.literalExpression "bgremove flake package";
      description = "The bgremove package to run.";
    };

    host = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address the web server binds to.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8000;
      description = "Port the web server listens on.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open {option}`port` in the firewall.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.bgremove = {
      description = "bgremove background-removal web service";
      wantedBy = [ "multi-user.target" ];
      # First request for a model downloads it (~170 MB), so we need network.
      after = [ "network-online.target" ];
      wants = [ "network-online.target" ];

      environment = {
        BGREMOVE_HOST = cfg.host;
        BGREMOVE_PORT = toString cfg.port;
        # rembg caches downloaded models here; keep it in the service state dir.
        U2NET_HOME = "/var/lib/bgremove/models";
      };

      serviceConfig = {
        ExecStart = lib.getExe' cfg.package "bgremove-web";
        DynamicUser = true;
        StateDirectory = "bgremove";
        Restart = "on-failure";

        # Hardening.
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ProtectHome = true;
        PrivateTmp = true;
        PrivateDevices = true;
        ProtectKernelTunables = true;
        ProtectKernelModules = true;
        ProtectControlGroups = true;
        RestrictAddressFamilies = [ "AF_INET" "AF_INET6" ];
        RestrictNamespaces = true;
        LockPersonality = true;
        MemoryDenyWriteExecute = false; # onnxruntime needs W^X exceptions
      };
    };

    networking.firewall.allowedTCPPorts = lib.mkIf cfg.openFirewall [ cfg.port ];
  };
}
