import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Role } from "aws-cdk-lib/aws-iam";
import { CodePipelineSource } from 'aws-cdk-lib/pipelines';
import * as codebuild from "aws-cdk-lib/aws-codebuild";
import { TerraformBuild } from './terraform-build';
import { CfnOutput  } from 'aws-cdk-lib';

export interface DeploymentProps extends StackProps {
  infraRepoCode: CodePipelineSource;
  role: Role;
  infraRepoOwner: string;
  infraRepoSource: string;
}

export class DeploymentStack extends Stack {
  
  readonly apiUrl: CfnOutput; 
  
  constructor(scope: Construct, id: string, props: DeploymentProps) {
    super(scope, id, props);

    new TerraformBuild('Terraform Plan', {
      source: props.infraRepoCode,
      buildSpec: codebuild.BuildSpec.fromSourceFilename("plan-buildspec.yml"),
      role: props.role,
      envVars: {
          environment: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: 'dev'
          },
          s3_terraform: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_terraform
          },
          lets_encrypt_email: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.lets_encrypt_email
          },
          base_domain: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.base_domain
          },
          hosted_zone_id: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.hosted_zone_id
          },
          s3_terraform_plan: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_terraform_plan
          },
          s3_artifacts_builds: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.s3_artifacts_builds
          },
          cert_arn: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.cert_arn
          },
          github_access_token: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.github_access_token
          },
          access_token_suffix: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.github_access_token_suffix
          },
          region: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.region
          },
          branch: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: process.env.branch
          },
          github_repo_owner: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: props.infraRepoOwner
          },
          github_repo: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: props.infraRepoSource
          },
          account_id: {
            type: codebuild.BuildEnvironmentVariableType.PLAINTEXT,
            value: this.account
          },
        }
    })
    
    this.apiUrl = new CfnOutput(this, 'endpointUrl', {
      value: `test-controller.${process.env.base_domain}:8443/auth`
  
    });
  }
}
