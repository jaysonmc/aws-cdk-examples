import { BuildSpec, LinuxBuildImage, ComputeType, BuildEnvironmentVariable } from 'aws-cdk-lib/aws-codebuild';
import { CodeBuildStep, CodePipelineSource } from 'aws-cdk-lib/pipelines';
import { Role } from "aws-cdk-lib/aws-iam";

export interface TerraformBuildProps {
  source: CodePipelineSource;
  buildSpec: BuildSpec;
  role: Role;
  envVars: { 
      [name: string]: BuildEnvironmentVariable; 
  };
}

export class TerraformBuild extends CodeBuildStep {
  constructor(id: string, props: TerraformBuildProps) {
    const stepProps = {
      input: props.source,
      commands: [],
      buildEnvironment: {
        buildImage: LinuxBuildImage.STANDARD_5_0,
        privileged: false,
        computeType: ComputeType.MEDIUM,
        environmentVariables: props.envVars,
      },
      partialBuildSpec: props.buildSpec,
      role: props.role,
    };
    super(id, stepProps);
  }
}
